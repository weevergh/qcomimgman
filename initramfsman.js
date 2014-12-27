#!/usr/local/bin/node

var fs = require('fs'),
    path = require('path'),
    zlib = require('zlib');

function padLeft( number, width, filler ) {
    filler = filler || ' ';
    width -= number.toString().length;
    if ( width > 0 )
        return new Array( width + (/\./.test( number ) ? 2 : 1) ).join( filler ) + number;
    return number + ""; // always return a string
}

function help() {
    console.log("Usage:");
    console.log(process.argv[1] + " <tree|ls|cat|create|modify> [args]");
    console.log("Simple initramfs(gzipped cpio newc archive) manipulation script.")
    console.log(" Functions:")
    console.log("  tree <image file> [max dump level]");
    console.log("  ls <image file> [target path]");
    console.log("  cat <image file> <target file>");
    console.log("  create <input dir> <output file>");
    console.log("  modify <image file> [commands]");
    console.log("   command syntax:");
    console.log("    mkdir <archive path>");
    console.log("    chown <archive path> <uid> <gid>");
    console.log("    chmod <archive path> <access mode in 4 digit, ex. 4755 would translate to srwxr-xr-x>");
    console.log("    put <local file> <archive file>");
    console.log("    link <source path> <archive path>");
    console.log("    remove <archive file/directory>");
}

// Ugly implementation to suite certain needs
// For example only '.' is considered valid root, etc.
function InitRamFs(data) {    
    this._$tree = { 
        subdirs: { },
        files: { }, 
        nodeinfo: undefined
    };
    if(Array.isArray(data)) data.forEach(function(e) { this.addEntry(e); }, this);
    else if(Buffer.isBuffer(data)) this.fromBuffer(data);
}
InitRamFs.prototype.validate = function() {
    function walkInitRamFs(node, cb) {
        cb(node.nodeinfo);
        for(var e in node.subdirs)
            walkInitRamFs(node.subdirs[e], cb);
        for(var e in node.files)
            cb(node.files[e]);
    }
    var res = true;
    walkInitRamFs(this._$tree, function(stats) {
        if(res && (stats === undefined))
            res = false;
    });
    return res;
}
InitRamFs.prototype.alloc_ino = function() {
    function walkInitRamFs(node, cb) {
        cb(node.nodeinfo);
        for(var e in node.subdirs)
            walkInitRamFs(node.subdirs[e], cb);
        for(var e in node.files)
            cb(node.files[e]);
    }
    var ino = true;
    walkInitRamFs(this._$tree, function(stats) {
        if(ino < stats.ino) ino = stats.ino;
    });
    return ino + 1;
}
InitRamFs.prototype.fromBuffer = function(newc_data) {
    for(var i = 0; i < newc_data.length; ) {
        if((i % 4) !== 0) {
            i += 4 - (i % 4);
            continue;
        }
        if(newc_data.slice(i, i + 6).toString() !== '070701') {
            if(newc_data[i] !== 0) {
                console.log('Error extracting file entry from initramfs. ' + i + ':' + newc_data.length);
                console.log(JSON.stringify(newc_data.slice(i - 6, i + 6)));
                break;
            } else {
                i++;
                continue;
            }
        }
        var file_entry = new fs.Stats;

        file_entry.ino = parseInt(newc_data.slice(i + 6, i + 14).toString(), 16);          //File inode number
        file_entry.mode = parseInt(newc_data.slice(i + 14, i + 22).toString(), 16);        //File mode and permissions
        file_entry.uid = parseInt(newc_data.slice(i + 22, i + 30).toString(), 16);         //File uid
        file_entry.gid = parseInt(newc_data.slice(i + 30, i + 38).toString(), 16);         //File gid
        file_entry.nlink = parseInt(newc_data.slice(i + 38, i + 46).toString(), 16);       //Number of links
        file_entry.mtime = parseInt(newc_data.slice(i + 46, i + 54).toString(), 16);       //Modification time
        file_entry.size = parseInt(newc_data.slice(i + 54, i + 62).toString(), 16);        //Size of data field
        file_entry.maj = parseInt(newc_data.slice(i + 62, i + 70).toString(), 16);         //Major part of file device number
        file_entry.min = parseInt(newc_data.slice(i + 70, i + 78).toString(), 16);         //Minor part of file device number
        file_entry.rmaj = parseInt(newc_data.slice(i + 78, i + 86).toString(), 16);        //Major part of device node reference
        file_entry.rmin = parseInt(newc_data.slice(i + 86, i + 94).toString(), 16);        //Minor part of device node reference
        file_entry.namesize = parseInt(newc_data.slice(i + 94, i + 102).toString(), 16);   //Length of filename, including final \0
        file_entry.chksum = parseInt(newc_data.slice(i + 102, i + 110).toString(), 16);    //zero
        
        file_entry.dev = (file_entry.maj << 8) + file_entry.min;
        file_entry.rdev = (file_entry.rmaj << 8) + file_entry.rmin;

        file_entry.name = newc_data.slice(i + 110, i + 110 + file_entry.namesize).toString();
        file_entry.name = file_entry.name.replace(/\u0000$/, '');
        var data_start_pos = i + 110 + file_entry.namesize;
        if((data_start_pos % 4) !== 0) data_start_pos += 4 - (data_start_pos % 4);
        file_entry.data = newc_data.slice(data_start_pos, data_start_pos + file_entry.size);
        this.addEntry(file_entry);

        if(file_entry.name === "TRAILER!!!")
            if(file_entry.ino +
                file_entry.mode +
                file_entry.uid +
                file_entry.gid +
                file_entry.nlink +
                file_entry.mtime +
                file_entry.size +
                file_entry.maj +
                file_entry.min +
                file_entry.rmaj +
                file_entry.rmin +
                file_entry.namesize +
                file_entry.chksum +
                file_entry.data.length === 12)
                break;
        i = data_start_pos + file_entry.size;
    }
    if(!this.validate()) throw new Error('Invalid tree, something is wrong.');
}
InitRamFs.prototype.toBuffer = function() {
    if(!this.validate()) {
        console.log('Invalid tree structure.')
        return;
    }

    function walkInitRamFs(node, cb) {
        cb(node.nodeinfo);
        for(var e in node.subdirs)
            walkInitRamFs(node.subdirs[e], cb);
        for(var e in node.files)
            cb(node.files[e]);
    }

    var res_buffer = new Buffer(0);

    walkInitRamFs(this._$tree, function(stats) {
        var entry_buffer_len = 110 + stats.namesize,
            data_start_pos = 0;

        if((entry_buffer_len % 4) !== 0) entry_buffer_len += 4 - (entry_buffer_len % 4);
        data_start_pos = entry_buffer_len;
        entry_buffer_len += stats.size;
        if((entry_buffer_len % 4) !== 0) entry_buffer_len += 4 - (entry_buffer_len % 4);

        var entry_buffer = new Buffer(entry_buffer_len);
        for(var i = 0 ; i < entry_buffer_len; i ++)
            entry_buffer[i] = 0;
        // write content
        entry_buffer.write("070701", 0, 6, 'ascii');
        entry_buffer.write(padLeft(stats.ino.toString(16), 8, '0'),  6, 8, 'ascii');          //File inode number
        entry_buffer.write(padLeft(stats.mode.toString(16), 8, '0'),  14, 8, 'ascii');        //File mode and permissions
        entry_buffer.write(padLeft(stats.uid.toString(16), 8, '0'),  22, 8, 'ascii');         //File uid
        entry_buffer.write(padLeft(stats.gid.toString(16), 8, '0'),  30, 8, 'ascii');         //File gid
        entry_buffer.write(padLeft(stats.nlink.toString(16), 8, '0'),  38, 8, 'ascii');       //Number of links
        entry_buffer.write(padLeft(stats.mtime.toString(16), 8, '0'),  46, 8, 'ascii');       //Modification time
        entry_buffer.write(padLeft(stats.size.toString(16), 8, '0'),  54, 8, 'ascii');        //Size of data field
        entry_buffer.write(padLeft(stats.maj.toString(16), 8, '0'),  62, 8, 'ascii');         //Major part of file device number
        entry_buffer.write(padLeft(stats.min.toString(16), 8, '0'),  70, 8, 'ascii');         //Minor part of file device number
        entry_buffer.write(padLeft(stats.rmaj.toString(16), 8, '0'),  78, 8, 'ascii');        //Major part of device node reference
        entry_buffer.write(padLeft(stats.rmin.toString(16), 8, '0'),  86, 8, 'ascii');        //Minor part of device node reference
        entry_buffer.write(padLeft(stats.namesize.toString(16), 8, '0'),  94, 8, 'ascii');    //Length of filename, including final \0
        entry_buffer.write(padLeft(stats.chksum.toString(16), 8, '0'),  102, 8, 'ascii');     //zero

        entry_buffer.write(stats.name + '\u0000', 110, stats.namesize);
        stats.data.copy(entry_buffer, data_start_pos);
        
        res_buffer = Buffer.concat([res_buffer, entry_buffer]);
    });
    
    var trailer = {
            name: 'TRAILER!!!',
            ino: 0, mode: 0, uid: 0, gid: 0,
            nlink: 1, mtime: 0, size: 0,
            maj: 0, min: 0,
            rmaj: 0, rmin: 0,
            namesize: 11, chksum: 0,
            dev: 0, rdev: 0,
            data: new Buffer(0)
        },
        trailer_buffer = new Buffer(124);
    for(var i = 0 ; i < trailer_buffer.length; i ++)
        trailer_buffer[i] = 0;
    trailer_buffer.write("070701", 0, 6, 'ascii');
    trailer_buffer.write(padLeft(trailer.ino.toString(16), 8, '0'),  6, 8, 'ascii');          //File inode number
    trailer_buffer.write(padLeft(trailer.mode.toString(16), 8, '0'),  14, 8, 'ascii');        //File mode and permissions
    trailer_buffer.write(padLeft(trailer.uid.toString(16), 8, '0'),  22, 8, 'ascii');         //File uid
    trailer_buffer.write(padLeft(trailer.gid.toString(16), 8, '0'),  30, 8, 'ascii');         //File gid
    trailer_buffer.write(padLeft(trailer.nlink.toString(16), 8, '0'),  38, 8, 'ascii');       //Number of links
    trailer_buffer.write(padLeft(trailer.mtime.toString(16), 8, '0'),  46, 8, 'ascii');       //Modification time
    trailer_buffer.write(padLeft(trailer.size.toString(16), 8, '0'),  54, 8, 'ascii');        //Size of data field
    trailer_buffer.write(padLeft(trailer.maj.toString(16), 8, '0'),  62, 8, 'ascii');         //Major part of file device number
    trailer_buffer.write(padLeft(trailer.min.toString(16), 8, '0'),  70, 8, 'ascii');         //Minor part of file device number
    trailer_buffer.write(padLeft(trailer.rmaj.toString(16), 8, '0'),  78, 8, 'ascii');        //Major part of device node reference
    trailer_buffer.write(padLeft(trailer.rmin.toString(16), 8, '0'),  86, 8, 'ascii');        //Minor part of device node reference
    trailer_buffer.write(padLeft(trailer.namesize.toString(16), 8, '0'),  94, 8, 'ascii');    //Length of filename, including final \0
    trailer_buffer.write(padLeft(trailer.chksum.toString(16), 8, '0'),  102, 8, 'ascii');     //zero
    trailer_buffer.write(trailer.name, 110);

    res_buffer = Buffer.concat([res_buffer, trailer_buffer]);

    if((res_buffer.length % 512) !== 0) {
        var padding = new Buffer(512 - (res_buffer.length % 512));
        for(var i = 0 ; i < padding.length; i ++)
            padding[i] = 0;
        res_buffer = Buffer.concat([res_buffer, padding]);
    }
    
    console.log((res_buffer.length / 512) + ' blocks')

    return res_buffer;
}
InitRamFs.prototype.addEntry = function(entry) {
    if((entry.name === 'TRAILER!!!') && (entry.dev === 0) &&
        (entry.rdev === 0) && (entry.ino === 0) && (entry.mode === 0))
        return;

    if(entry.name === '.') {  // root
        if(this._$tree.nodeinfo !== undefined) throw new Error('Duplicate root node');
        this._$tree.nodeinfo = entry;
        return;
    }
    var path_arr = entry.name.split(/\//g),
        curr_node = this._$tree;
    for(var i = 0; i < path_arr.length - 1; i ++) {
        if(curr_node.subdirs[path_arr[i]] === undefined)
            curr_node.subdirs[path_arr[i]] = { 
                subdirs: { },
                files: { }, 
                nodeinfo: undefined
            }
        curr_node = curr_node.subdirs[path_arr[i]];
    }

    if(entry.isDirectory()) {
        if(curr_node.subdirs[path_arr[path_arr.length - 1]] === undefined)
            curr_node.subdirs[path_arr[path_arr.length - 1]] = {
                subdirs: { },
                files: { }, 
                nodeinfo: entry
            }
        else if(curr_node.subdirs[path_arr[path_arr.length - 1]].nodeinfo !== undefined) 
            throw Error('Duplicate directory node ' + entry.name);
        else curr_node.subdirs[path_arr[path_arr.length - 1]].nodeinfo = entry;
    } else {
        if(curr_node.files[path_arr[path_arr.length - 1]] === undefined)
            curr_node.files[path_arr[path_arr.length - 1]] = entry;
        else throw Error('Duplicate entry node ' + entry.name);
    }
};
InitRamFs.prototype.dump = function(max_level) {
    function dump_one_folder(node, level) {
        /* print prefix */ 
        for(var i= 0 ; i < level; i++) {
            if(i === level -1) process.stdout.write('|-');
            else process.stdout.write('| ');
        }
        /* print name */
        process.stdout.write(path.basename(node.nodeinfo.name) + '/');
        if(level >= max_level) {
            console.log(' [...]');
            return;
        } else console.log('');
        /* print subdirs */
        for(var p in node.subdirs)
            dump_one_folder(node.subdirs[p], level + 1);
        /* print files */
        level += 1;
        for(var p in node.files) {
            /* print prefix */
            for(var i= 0 ; i < level; i++) {
                if(i === level -1) process.stdout.write('|-');
                else process.stdout.write('| ');
            }
            /* print name */
            console.log(p);
        }
    }
    dump_one_folder(this._$tree, 0);
};
InitRamFs.prototype.rm = function(p) {
    var path_arr = p.replace(/\/$/, '').split(/\//g),
        curr_node = this._$tree;
    for(var i = 0; i < path_arr.length - 1; i ++) {
        if(curr_node.subdirs[path_arr[i]] === undefined) {
            console.log('Failed to remove non-exit path "' + p + '"');
            return false;
        } else curr_node = curr_node.subdirs[path_arr[i]];
    }
    if(curr_node.subdirs[path_arr[path_arr.length - 1]]) {
        delete curr_node.subdirs[path_arr[path_arr.length - 1]];
        curr_node.nodeinfo.nlink -= 1;
        console.log('Removed directory "' + p + '"');
        return true;
    } else if(curr_node.files[path_arr[path_arr.length - 1]]) {
        delete curr_node.files[path_arr[path_arr.length - 1]];
        console.log('Removed entry "' + p + '"');
        return true;
    } else console.log('Failed to remove non-exit path "' + p + '"');
    return false;
};
InitRamFs.prototype.chown = function(p, uid_str, gid_str) {
    var uid = parseInt(uid_str, 10),
        gid = parseInt(gid_str, 10);

    if(Number.isNaN(uid) || Number.isNaN(gid)) {
        console.log('Invalid uid/gid');
        return false;
    }

    var path_arr = p.replace(/\/$/, '').split(/\//g),
        curr_node = this._$tree;
    for(var i = 0; i < path_arr.length - 1; i ++) {
        if(curr_node.subdirs[path_arr[i]] === undefined) {
            console.log('Failed to chown for non-exit path "' + p + '"');
            return false;
        } else curr_node = curr_node.subdirs[path_arr[i]];
    }
    if(curr_node.subdirs[path_arr[path_arr.length - 1]]) {
        curr_node.subdirs[path_arr[path_arr.length - 1]].nodeinfo.uid = uid;
        curr_node.subdirs[path_arr[path_arr.length - 1]].nodeinfo.gid = gid;
        console.log('Ownership of directory "' + p + '" is now uid: ' + uid + ' gid: ' + gid);
        return true;
    } else if(curr_node.files[path_arr[path_arr.length - 1]]) {
        curr_node.files[path_arr[path_arr.length - 1]].uid = uid;
        curr_node.files[path_arr[path_arr.length - 1]].gid = gid;
        console.log('Ownership of entry "' + p + '" is now uid: ' + uid + ' gid: ' + gid);
        return true;
    } else console.log('Failed to chown for non-exit path "' + p + '"');
    return false;
};
InitRamFs.prototype.chmod = function(p, mode_str) {
    var mode = parseInt(mode_str, 8);
    
    if(Number.isNaN(mode) || (typeof mode_str !== 'string') || (mode_str.length !== 4)) {
        console.log('Invalid mode ' + mode_str);
        return false;
    }

    var path_arr = p.replace(/\/$/, '').split(/\//g),
        curr_node = this._$tree;
    for(var i = 0; i < path_arr.length - 1; i ++) {
        if(curr_node.subdirs[path_arr[i]] === undefined) {
            console.log('Failed to chmod for non-exit path "' + p + '"');
            return false;
        } else curr_node = curr_node.subdirs[path_arr[i]];
    }
    if(curr_node.subdirs[path_arr[path_arr.length - 1]]) {
        curr_node.subdirs[path_arr[path_arr.length - 1]].nodeinfo.mode &= 0xF000;
        curr_node.subdirs[path_arr[path_arr.length - 1]].nodeinfo.mode |= mode;
        console.log('Mode of directory "' + p + '" is now ' + mode_str);
        return true;
    } else if(curr_node.files[path_arr[path_arr.length - 1]]) {
        curr_node.files[path_arr[path_arr.length - 1]].mode &= 0xF000;
        curr_node.files[path_arr[path_arr.length - 1]].mode |= mode;
        console.log('Mode of entry "' + p + '" is now ' + mode_str);
        return true;
    } else console.log('Failed to chmod for non-exit path "' + p + '"');
    return false;
};
InitRamFs.prototype.mkdir = function(p) {
    var path_arr = p.replace(/\/$/, '').split(/\//g),
        curr_node = this._$tree;
    for(var i = 0; i < path_arr.length - 1; i ++) {
        if(curr_node.subdirs[path_arr[i]] === undefined) {
            console.log('Failed to make directory cause parent "' + path_arr[i] + '" does not exit');
            return false;
        } else curr_node = curr_node.subdirs[path_arr[i]];
    }
    if(curr_node.subdirs[path_arr[path_arr.length - 1]])
        console.log('Failed to make directory, target already exists');
    else if(curr_node.files[path_arr[path_arr.length - 1]])
        console.log('Failed to make directory, target already exists');
    else {
        var new_dir_stats = new fs.Stats;

        new_dir_stats.data = new Buffer(0);
        new_dir_stats.size = new_dir_stats.data.length;
        new_dir_stats.name = p.replace(/\/$/, '');
        new_dir_stats.namesize = new_dir_stats.name.length + 1;
        new_dir_stats.mode = curr_node.nodeinfo.mode;
        new_dir_stats.maj = curr_node.nodeinfo.maj;
        new_dir_stats.min = curr_node.nodeinfo.min;
        new_dir_stats.rmaj = curr_node.nodeinfo.rmaj;
        new_dir_stats.rmin = curr_node.nodeinfo.rmin;
        new_dir_stats.uid = curr_node.nodeinfo.uid;
        new_dir_stats.gid = curr_node.nodeinfo.gid;
        new_dir_stats.mtime = Math.floor(Date.now() / 1000);
        new_dir_stats.ino = this.alloc_ino();
        new_dir_stats.chksum = 0;
        new_dir_stats.nlink = 2;

        curr_node.nodeinfo.nlink += 1;
        curr_node.subdirs[path_arr[path_arr.length - 1]] = {
            subdirs: { },
            files: { },
            nodeinfo: new_dir_stats
        };
        console.log('Made directory "' + p + '"');
        return true;
    }
    return false;
};
InitRamFs.prototype.ln = function(orig, target) {
    var path_arr = target.split(/\//g),
        curr_node = this._$tree;
    for(var i = 0; i < path_arr.length - 1; i ++) {
        if(curr_node.subdirs[path_arr[i]] === undefined) {
            console.log('Failed to make link cause parent "' + path_arr[i] + '" does not exit');
            return false;
        } else curr_node = curr_node.subdirs[path_arr[i]];
    }
    if(curr_node.subdirs[path_arr[path_arr.length - 1]])
        console.log('Failed to make link, target already exists');
    else if(curr_node.files[path_arr[path_arr.length - 1]])
        console.log('Failed to make link, target already exists');
    else {
        var new_link_stats = new fs.Stats;

        new_link_stats.data = new Buffer(orig);
        new_link_stats.size = new_link_stats.data.length;
        new_link_stats.name = target;
        new_link_stats.namesize = new_link_stats.name.length + 1;
        new_link_stats.mode = curr_node.nodeinfo.mode & 0xFFF | 0xA000;
        new_link_stats.maj = curr_node.nodeinfo.maj;
        new_link_stats.min = curr_node.nodeinfo.min;
        new_link_stats.rmaj = curr_node.nodeinfo.rmaj;
        new_link_stats.rmin = curr_node.nodeinfo.rmin;
        new_link_stats.uid = curr_node.nodeinfo.uid;
        new_link_stats.gid = curr_node.nodeinfo.gid;
        new_link_stats.mtime = Math.floor(Date.now() / 1000);
        new_link_stats.ino = this.alloc_ino();
        new_link_stats.chksum = 0;
        new_link_stats.nlink = 1;

        curr_node.files[path_arr[path_arr.length - 1]] = new_link_stats;

        console.log('Made soft link "' + target + '" -> "' + orig + '"');
        return true;
    }
    return false;
};
InitRamFs.prototype.put = function(local_file, target) {
    if((!local_file) || (typeof local_file !== 'string') || 
        (local_file.trim().length === 0) || (!fs.existsSync(local_file)) ||
        (!fs.statSync(local_file).isFile())) {
        console.log('Cannod put invalid local file "' + local_file + '" into archive');
        return false;
    }

    var path_arr = target.split(/\//g),
        curr_node = this._$tree;
    for(var i = 0; i < path_arr.length - 1; i ++) {
        if(curr_node.subdirs[path_arr[i]] === undefined) {
            console.log('Failed to put file cause parent "' + path_arr[i] + '" does not exit');
            return false;
        } else curr_node = curr_node.subdirs[path_arr[i]];
    }
    if(curr_node.subdirs[path_arr[path_arr.length - 1]])
        console.log('Failed to put file, target already exists');
    else if(curr_node.files[path_arr[path_arr.length - 1]])
        console.log('Failed to put file, target already exists');
    else {
        var new_file_stats = new fs.Stats;

        new_file_stats.data = fs.readFileSync(local_file);
        new_file_stats.size = new_file_stats.data.length;
        new_file_stats.name = target;
        new_file_stats.namesize = new_file_stats.name.length + 1;
        new_file_stats.mode = curr_node.nodeinfo.mode & 0xFFF | 0x8000;
        new_file_stats.maj = curr_node.nodeinfo.maj;
        new_file_stats.min = curr_node.nodeinfo.min;
        new_file_stats.rmaj = curr_node.nodeinfo.rmaj;
        new_file_stats.rmin = curr_node.nodeinfo.rmin;
        new_file_stats.uid = curr_node.nodeinfo.uid;
        new_file_stats.gid = curr_node.nodeinfo.gid;
        new_file_stats.mtime = Math.floor(Date.now() / 1000);
        new_file_stats.ino = this.alloc_ino();
        new_file_stats.chksum = 0;
        new_file_stats.nlink = 1;

        curr_node.files[path_arr[path_arr.length - 1]] = new_file_stats;

        console.log('Put local file "' + local_file + '" to "' + target + '"');
        return true;
    }
    return false;
};
InitRamFs.prototype.ls = function(p) {
    function print_entry(stats, max_nlink_str_len, max_size_str_len) {        
        process.stdout.write(padLeft(stats.mode.toString(8), 7, '0'));
        process.stdout.write(' ');
        process.stdout.write(padLeft(stats.nlink.toString(10), max_nlink_str_len, ' '));
        process.stdout.write(' ');
        process.stdout.write(padLeft(stats.uid.toString(10), 5, ' '));
        process.stdout.write(' ');
        process.stdout.write(padLeft(stats.gid.toString(10), 5, ' '));
        process.stdout.write('  ');
        process.stdout.write(padLeft(stats.size.toString(10), max_size_str_len, ' '));
        process.stdout.write(' ');
        process.stdout.write(new Date(stats.mtime * 1000).toJSON().replace(/\.000Z$/, ''));
        process.stdout.write(' ');
        process.stdout.write(path.basename(stats.name));
        if(stats.isDirectory()) process.stdout.write('/')
        else if(stats.isSymbolicLink()) {
            process.stdout.write(' -> ');
            process.stdout.write(stats.data);
        }
        process.stdout.write('\n');
    }
    function print_dir(node) {
        var max_size_str_len = 0,
            max_nlink_str_len = 0,
            stats_arr = [ ];
        for(var e in node.subdirs) {
            stats_arr.push(node.subdirs[e].nodeinfo);
            if(node.subdirs[e].nodeinfo.nlink.toString().length > max_nlink_str_len)
                max_nlink_str_len = node.subdirs[e].nodeinfo.nlink.toString().length;
            if(node.subdirs[e].nodeinfo.size.toString().length > max_size_str_len)
                max_size_str_len = node.subdirs[e].nodeinfo.size.toString().length;
        }
        for(var e in node.files) {
            stats_arr.push(node.files[e]);
            if(node.files[e].nlink.toString().length > max_nlink_str_len)
                max_nlink_str_len = node.files[e].nlink.toString().length;
            if(node.files[e].size.toString().length > max_size_str_len)
                max_size_str_len = node.files[e].size.toString().length;
        }
        stats_arr.forEach(function(s) {
            print_entry(s, max_nlink_str_len, max_size_str_len);
        });
    }
    if((!p) || (typeof p !== 'string') || (p.trim().length === 0))
        console.log('No target path provided to list.');
    else if(p === '.') print_entry(this._$tree.nodeinfo);
    else if(p === './') print_dir(this._$tree);
    else {
        var path_arr = p.replace(/\/$/, '').split(/\//g),
            curr_node = this._$tree;
        for(var i = 0; i < path_arr.length - 1; i ++) {
            if(curr_node.subdirs[path_arr[i]] === undefined) {
                console.log('Path "' + p + '" does not exit.');
                return true;
            } else curr_node = curr_node.subdirs[path_arr[i]];
        }
        if(curr_node.subdirs[path_arr[path_arr.length - 1]]) {
            if(/\/$/.test(p)) print_dir(curr_node.subdirs[path_arr[path_arr.length - 1]]);
            else print_entry(curr_node.subdirs[path_arr[path_arr.length - 1]].nodeinfo);
        } else if(curr_node.files[path_arr[path_arr.length - 1]]) print_entry(curr_node.files[path_arr[path_arr.length - 1]]);
        else console.log('Path "' + p + '" does not exit.'); 
    }
    return true
};
InitRamFs.prototype.cat = function(p) {
    var path_arr = p.replace(/\/$/, '').split(/\//g),
        curr_node = this._$tree;
    for(var i = 0; i < path_arr.length - 1; i ++) {
        if(curr_node.subdirs[path_arr[i]] === undefined) {
            console.log('Path "' + p + '" does not exit.');
            return true;
        } else curr_node = curr_node.subdirs[path_arr[i]];
    }
    if(curr_node.subdirs[path_arr[path_arr.length - 1]]) console.log('Path "' + p + '" is a directory.');
    else if(curr_node.files[path_arr[path_arr.length - 1]])
        process.stdout.write(curr_node.files[path_arr[path_arr.length - 1]].data);
    else console.log('Path "' + p + '" does not exit.');
    return true;
}

function main_dump_tree_initramfs() {
    var imgfile = undefined,
        max_level = undefined;

    for(var i = 2; i < process.argv.length; i ++) {
        if(imgfile === undefined) imgfile = process.argv[i];
        else if(max_level === undefined) max_level = parseInt(process.argv[i], 10);
        else {
            console.log('Invalid commandline option: ' + process.argv[i]);
            return help();
        }
    }
    if((!imgfile) || (typeof imgfile !== 'string') || 
        (imgfile.trim().length === 0) || (!fs.existsSync(imgfile)) ||
        (!fs.statSync(imgfile).isFile())) {
        console.log('Invalid image file: ' + imgfile);
        return 1;
    }
    if(max_level === undefined) max_level = Number.MAX_VALUE;
    if(Number.isNaN(max_level)) {
        console.log('Invalid max dump level ' + max_level);
        return 1;
    }

    zlib.gunzip(fs.readFileSync(imgfile), function(err, newc_data) {
        new InitRamFs(newc_data).dump(max_level);
    })
}

function main_ls_initramfs() {
    var imgfile = undefined,
        target_path = undefined;

    for(var i = 2; i < process.argv.length; i ++) {
        if(imgfile === undefined) imgfile = process.argv[i];
        else if(target_path === undefined) target_path = process.argv[i];
        else {
            console.log('Invalid commandline option: ' + process.argv[i]);
            return help();
        }
    }
    if((!imgfile) || (typeof imgfile !== 'string') || 
        (imgfile.trim().length === 0) || (!fs.existsSync(imgfile)) ||
        (!fs.statSync(imgfile).isFile())) {
        console.log('Invalid image file: ' + imgfile);
        return 1;
    }
    if(!target_path) target_path = './';

    zlib.gunzip(fs.readFileSync(imgfile), function(err, newc_data) {
        new InitRamFs(newc_data).ls(target_path);
    })
}

function main_cat_file_initramfs() {
    var imgfile = undefined,
        target_path = undefined;

    for(var i = 2; i < process.argv.length; i ++) {
        if(imgfile === undefined) imgfile = process.argv[i];
        else if(target_path === undefined) target_path = process.argv[i];
        else {
            console.log('Invalid commandline option: ' + process.argv[i]);
            return help();
        }
    }
    if((!imgfile) || (typeof imgfile !== 'string') || 
        (imgfile.trim().length === 0) || (!fs.existsSync(imgfile)) ||
        (!fs.statSync(imgfile).isFile())) {
        console.log('Invalid image file: ' + imgfile);
        return 1;
    }
    if((!target_path)|| (typeof target_path !== 'string') || (target_path.trim().length === 0)) {
        console.log('Invalid target file: ' + target_path);
        return 1;
    }

    zlib.gunzip(fs.readFileSync(imgfile), function(err, newc_data) {
        new InitRamFs(newc_data).cat(target_path);
    })
}

function main_create_initramfs() {
    var root_dir = undefined,
        output_file = undefined;

    for(var i = 2; i < process.argv.length; i ++) {
        if(root_dir === undefined) root_dir = process.argv[i];
        else if(output_file === undefined) output_file = process.argv[i];
        else {
            console.log('Invalid commandline option: ' + process.argv[i]);
            return help();
        }
    }
    if((!root_dir) || (typeof root_dir !== 'string') || 
        (root_dir.trim().length === 0) || (!fs.existsSync(root_dir)) ||
        (!fs.statSync(root_dir).isDirectory())) {
        console.log('Invalid root dir: ' + root_dir);
        return 1;
    }
    if((!output_file)|| (typeof output_file !== 'string') || 
        (output_file.trim().length === 0) || (!fs.existsSync(path.dirname(output_file))) || 
        (!fs.statSync(path.dirname(output_file)).isDirectory())) {
        console.log('Invalid output path: ' + output_file);
        return 1;
    }    

    var tree = new InitRamFs,
        root_stats = fs.statSync(root_dir);
    root_stats.mtime = Math.floor(root_stats.mtime.getTime() / 1000);
    root_stats.maj = root_stats.dev >> 8;
    root_stats.min = root_stats.dev - (root_stats.maj << 8);
    root_stats.rmaj = root_stats.rdev >> 8;
    root_stats.rmin = root_stats.rdev - (root_stats.rmaj << 8);
    root_stats.namesize = 2;
    root_stats.chksum = 0;
    root_stats.name = '.';
    root_stats.data = new Buffer(0);
    root_stats.size = root_stats.data .length;

    tree.addEntry(root_stats);

    function walkLocalInitRamFs(target_path, archive_path) {
        var non_dirs = [ ];
        fs.readdirSync(target_path).forEach(function(e) {
            var entry_path = archive_path.slice(),
                local_path = path.join(target_path, e),
                stats = fs.lstatSync(local_path);

            entry_path.push(e);
            stats.name = entry_path.join('/');
            if(stats.isSymbolicLink()) stats.data = new Buffer(fs.readlinkSync(local_path));
            else if(stats.isFile()) stats.data = fs.readFileSync(local_path);
            else stats.data = new Buffer(0);
            stats.size = stats.data.length;
            stats.chksum = 0;
            stats.namesize = stats.name.length + 1;
            stats.maj = stats.dev >> 8;
            stats.min = stats.dev - (stats.maj << 8);
            stats.rmaj = stats.rdev >> 8;
            stats.rmin = stats.rdev - (stats.rmaj << 8);
            stats.mtime = Math.floor(stats.mtime.getTime() / 1000);
            
            if(stats.isDirectory()) {
                tree.addEntry(stats);
                walkLocalInitRamFs(local_path, entry_path);
            } else non_dirs.push(stats);
        });
        non_dirs.forEach(function(e) {
            tree.addEntry(e);
        });
    }
    walkLocalInitRamFs(root_dir, [ ]);

    zlib.gzip(tree.toBuffer(), function(err, gz_data) {
        fs.writeFileSync(output_file, gz_data);
    });
}

function main_modify_initramfs() {
    var imgfile = undefined,
        cmd_list = [];

    for(var i = 2; i < process.argv.length; i ++) {
        if(imgfile === undefined) imgfile = process.argv[i];
        else {
            switch(process.argv[i]) {
                case 'm':
                case 'md':
                case 'mkdir':
                    cmd_list.push({ cmd: 'mkdir', args: [process.argv[++ i]] });
                    break;
                case 'a':
                case 'add':
                case 'p':
                case 'put':
                    cmd_list.push({ cmd: 'put', args: [process.argv[++ i], process.argv[++ i]] });
                    break;
                case 'chown':
                    cmd_list.push({ cmd: 'chown', args: [process.argv[++ i], process.argv[++ i], process.argv[++ i]] });
                    break;
                case 'chmod':
                    cmd_list.push({ cmd: 'chmod', args: [process.argv[++ i], process.argv[++ i]] });
                    break;
                case 'l':
                case 'ln':
                case 'link':
                    cmd_list.push({ cmd: 'ln', args: [process.argv[++ i], process.argv[++ i]] });
                    break;
                case 'r':
                case 'rm':
                case 'remove':
                    cmd_list.push({ cmd: 'rm', args: [process.argv[++ i]] });
                    break;
                default: {
                    console.log('Invalid commandline option: ' + process.argv[i]);
                    return help();
                }
            }
        }
    }
    if((!imgfile) || (typeof imgfile !== 'string') || 
        (imgfile.trim().length === 0) || (!fs.existsSync(imgfile)) ||
        (!fs.statSync(imgfile).isFile())) {
        console.log('Invalid image file: ' + imgfile);
        return 1;
    }

    if(cmd_list.length >0 ) {
        zlib.gunzip(fs.readFileSync(imgfile), function(err, newc_data) {
            var tree = new InitRamFs(newc_data);
            for(var i = 0; i < cmd_list.length; i ++)
                if(!tree[cmd_list[i].cmd].apply(tree, cmd_list[i].args)) {
                    console.log('Archive not modified.');
                    return 1;
                }
            zlib.gzip(tree.toBuffer(), function(err, gz_data) {
                fs.writeFileSync(imgfile, gz_data);
            });
        })
    } else console.log("No commands provided, archive not modified.");
}

if(require.main === module) {
    switch(process.argv[2]) {
        case "t":
        case "tree":
            process.argv.splice(2, 1);
            main_dump_tree_initramfs();
            break;
        case "l":
        case "ls":
        case "list":
            process.argv.splice(2, 1);
            main_ls_initramfs();
            break;
        case "cat":
            process.argv.splice(2, 1);
            main_cat_file_initramfs();
            break;
        case "c":
        case "create":
            process.argv.splice(2, 1);
            main_create_initramfs();
            break;
        case "m":
        case "modify":
            process.argv.splice(2, 1);
            main_modify_initramfs();
            break;
        default: return help();
    }
} else module.exports = InitRamFs;


// See: https://www.kernel.org/doc/Documentation/early-userspace/buffer-format.txt
//
//
//                initramfs buffer format
//                -----------------------
//
//                Al Viro, H. Peter Anvin
//               Last revision: 2002-01-13
//
// Starting with kernel 2.5.x, the old "initial ramdisk" protocol is
// getting {replaced/complemented} with the new "initial ramfs"
// (initramfs) protocol.  The initramfs contents is passed using the same
// memory buffer protocol used by the initrd protocol, but the contents
// is different.  The initramfs buffer contains an archive which is
// expanded into a ramfs filesystem; this document details the format of
// the initramfs buffer format.
//
// The initramfs buffer format is based around the "newc" or "crc" CPIO
// formats, and can be created with the cpio(1) utility.  The cpio
// archive can be compressed using gzip(1).  One valid version of an
// initramfs buffer is thus a single .cpio.gz file.
//
// The full format of the initramfs buffer is defined by the following
// grammar, where:
//     *    is used to indicate "0 or more occurrences of"
//     (|)    indicates alternatives
//     +    indicates concatenation
//     GZIP()    indicates the gzip(1) of the operand
//     ALGN(n)    means padding with null bytes to an n-byte boundary
//
//     initramfs  := ("\0" | cpio_archive | cpio_gzip_archive)*
//
//     cpio_gzip_archive := GZIP(cpio_archive)
//
//     cpio_archive := cpio_file* + (<nothing> | cpio_trailer)
//
//     cpio_file := ALGN(4) + cpio_header + filename + "\0" + ALGN(4) + data
//
//     cpio_trailer := ALGN(4) + cpio_header + "TRAILER!!!\0" + ALGN(4)
//
//
// In human terms, the initramfs buffer contains a collection of
// compressed and/or uncompressed cpio archives (in the "newc" or "crc"
// formats); arbitrary amounts zero bytes (for padding) can be added
// between members.
//
// The cpio "TRAILER!!!" entry (cpio end-of-archive) is optional, but is
// not ignored; see "handling of hard links" below.
//
// The structure of the cpio_header is as follows (all fields contain
// hexadecimal ASCII numbers fully padded with '0' on the left to the
// full width of the field, for example, the integer 4780 is represented
// by the ASCII string "000012ac"):
//
// Field name    Field size     Meaning
// c_magic          6 bytes         The string "070701" or "070702"
// c_ino          8 bytes         File inode number
// c_mode          8 bytes         File mode and permissions
// c_uid          8 bytes         File uid
// c_gid          8 bytes         File gid
// c_nlink          8 bytes         Number of links
// c_mtime          8 bytes         Modification time
// c_filesize    8 bytes         Size of data field
// c_maj          8 bytes         Major part of file device number
// c_min          8 bytes         Minor part of file device number
// c_rmaj          8 bytes         Major part of device node reference
// c_rmin          8 bytes         Minor part of device node reference
// c_namesize    8 bytes         Length of filename, including final \0
// c_chksum      8 bytes         Checksum of data field if c_magic is 070702;
//                  otherwise zero
//
// The c_mode field matches the contents of st_mode returned by stat(2)
// on Linux, and encodes the file type and file permissions.
//
// The c_filesize should be zero for any file which is not a regular file
// or symlink.
//
// The c_chksum field contains a simple 32-bit unsigned sum of all the
// bytes in the data field.  cpio(1) refers to this as "crc", which is
// clearly incorrect (a cyclic redundancy check is a different and
// significantly stronger integrity check), however, this is the
// algorithm used.
//
// If the filename is "TRAILER!!!" this is actually an end-of-archive
// marker; the c_filesize for an end-of-archive marker must be zero.
//
//
// *** Handling of hard links
//
// When a nondirectory with c_nlink > 1 is seen, the (c_maj,c_min,c_ino)
// tuple is looked up in a tuple buffer.  If not found, it is entered in
// the tuple buffer and the entry is created as usual; if found, a hard
// link rather than a second copy of the file is created.  It is not
// necessary (but permitted) to include a second copy of the file
// contents; if the file contents is not included, the c_filesize field
// should be set to zero to indicate no data section follows.  If data is
// present, the previous instance of the file is overwritten; this allows
// the data-carrying instance of a file to occur anywhere in the sequence
// (GNU cpio is reported to attach the data to the last instance of a
// file only.)
//
// c_filesize must not be zero for a symlink.
//
// When a "TRAILER!!!" end-of-archive marker is seen, the tuple buffer is
// reset.  This permits archives which are generated independently to be
// concatenated.
//
// To combine file data from different sources (without having to
// regenerate the (c_maj,c_min,c_ino) fields), therefore, either one of
// the following techniques can be used:
//
// a) Separate the different file data sources with a "TRAILER!!!"
//    end-of-archive marker, or
//
// b) Make sure c_nlink == 1 for all nondirectory entries.