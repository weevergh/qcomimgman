#!/usr/local/bin/node

var fs = require('fs'),
    path = require('path'),
    zlib = require('zlib'),
    initramfsman = undefined;

if(fs.existsSync('./initramfsman.js') && fs.statSync('./initramfsman.js').isFile())
    initramfsman = require('./initramfsman.js');

function zeroFill( number, width ) {
    width -= number.toString().length;
    if ( width > 0 ) {
        return new Array( width + (/\./.test( number ) ? 2 : 1) ).join( '0' ) + number;
    }
    return number + ""; // always return a string
}

function extract_portion(fd, pos, length, output_file_path) {
    if(length) {
        var b = new Buffer(length);
        fs.read(fd, b, 0, length, pos, function(err, bytesRead) {
            if(err) {
                console.log("Failed to read data: " + e.message);
                return;
            } else if(bytesRead != length) {
                console.log("Failed to read data, only got " + bytesRead + ' bytes, expecting ' + length + '.');
                return;
            } 
            try { fs.writeFileSync(output_file_path, b); }
            catch(err) {
                console.log("Failed to write data: " + err.message);
                return;
            }
            console.log("Extracted " + output_file_path);
        });
    } else {
        try { fs.writeFileSync(output_file_path, ""); }
        catch(err) {
            console.log("Failed to write data: " + err.message);
            return;
        }
        console.log("Extracted " + output_file_path);
    }
}

function help() {
    console.log("Usage:");
    console.log(process.argv[1] + " <info|extract|create|modify|initrd> [args]");
    console.log("QCOM boot/recovery image manipulation script.")
    console.log(" Functions:")
    console.log("  common:");
    console.log("   --help            this help screen");
    console.log("  info <input file>");
    console.log("  extract [options] <input file>");
    console.log("   --output-dir      output path, mandantory");
    console.log("  create [options]");
    console.log("   --output-file     output file, mandantory");
    console.log("   --kernel          kernel file, mandantory");
    console.log("   --kernel-addr   kernel load addr");
    console.log("   --ramdisk         ramdisk file, mandantory");
    console.log("   --ramdisk-addr  ramdisk load addr");
    console.log("   --second          second file");
    console.log("   --second-addr   second load addr");
    console.log("   --tags-addr     tags load addr");
    console.log("   --page-size       page size in bytes");
    console.log("   --dt              dt file");
    console.log("   --board-name      board name");
    console.log("   --cmdline         kernel cmdline, mandantory");
    console.log("  modify [options] <input file>");
    console.log("   --output-file     output file, modify in place if omitted");
    console.log("   --kernel          replacement kernel file");
    console.log("   --kernel-addr   replacement kernel load addr");
    console.log("   --ramdisk         replacement ramdisk file");
    console.log("   --ramdisk-addr  replacement ramdisk load addr");
    console.log("   --second          replacement second file");
    console.log("   --second-addr   replacement second load addr");
    console.log("   --tags-addr     replacement tags load addr");
    console.log("   --page-size       replacement page size in bytes");
    console.log("   --dt              replacement dt file");
    console.log("   --board-name      replacement board name");
    console.log("   --cmdline         replacement kernel cmdline");
    if(initramfsman) {
        console.log("  initrd [options] <input file> [commands]");
        console.log("    option:");
        console.log("      --output-file output file, modify in place if omitted");
        console.log("    command:");
        console.log("      ls [target path]");
        console.log("      cat <target file>");
        console.log("      mkdir <initrd path>");
        console.log("      chown <initrd path> <uid> <gid>");
        console.log("      chmod <initrd path> <access mode in 4 digit, ex. 4755 would translate to srwxr-xr-x>");
        console.log("      put <local file> <initrd file>");
        console.log("      link <source path> <initrd path>");
        console.log("      remove <initrd file/directory>");

    }
}

function BootImg(full_data_or_magic) {
    if(Buffer.isBuffer(full_data_or_magic)) 
        this.fromBuffer(full_data_or_magic);
    else if((typeof full_data_or_magic === 'string') && (full_data_or_magic === 'ANDROID!')) {
    	var args = [];
    	for(var i = 1; i < arguments.length; i++) args.push(arguments[i]);
        this.fromParts.apply(this, args);
    }
    if(!this.validate) throw new Error('Invalid image buffer.');
}

BootImg.prototype.validate = function() {
    if(typeof this.kernel_addr !== "number") return false;
    if(typeof this.ramdisk_addr !== "number") return false;
    if(typeof this.second_addr !== "number") return false;
    if(typeof this.tags_addr !== "number") return false;
    if(typeof this.page_size !== "number") return false;
    if(typeof this.unused !== "number") return false;
    if(typeof this.name !== "string") return false;
    if(typeof this.cmdline !== "string") return false;
    if(!Buffer.isBuffer(this.kernel_data)) return false;
    if(!Buffer.isBuffer(this.ramdisk_data)) return false;
    if(!Buffer.isBuffer(this.second_data)) return false;
    if(!Buffer.isBuffer(this.dt_data)) return false;

    return true;
}

BootImg.prototype.toBuffer = function() {
    var n = Math.floor((this.kernel_data.length + this.page_size - 1) / this.page_size),
        m = Math.floor((this.ramdisk_data.length + this.page_size - 1) / this.page_size),
        o = Math.floor((this.second_data.length + this.page_size - 1) / this.page_size),
        p = Math.floor((this.dt_data.length + this.page_size - 1) / this.page_size),
        final_buffer = new Buffer((1 + n + m + o + p) * this.page_size);

    for(var i = 0; i < final_buffer.length; i++) final_buffer[i] = 0;

	final_buffer.write('ANDROID!', 0, 8, 'ascii');
    
    final_buffer.writeUInt32LE(this.kernel_data.length, 8);     /* size in bytes */
    final_buffer.writeUInt32LE(this.kernel_addr, 12);           /* physical load addr */
    final_buffer.writeUInt32LE(this.ramdisk_data.length, 16);   /* size in bytes */
    final_buffer.writeUInt32LE(this.ramdisk_addr, 20);          /* physical load addr */
    final_buffer.writeUInt32LE(this.second_data.length, 24);    /* size in bytes */
    final_buffer.writeUInt32LE(this.second_addr, 28);           /* physical load addr */
    final_buffer.writeUInt32LE(this.tags_addr, 32);             /* physical addr for kernel tags */
    final_buffer.writeUInt32LE(this.page_size, 36);             /* flash page size we assume */
    final_buffer.writeUInt32LE(this.dt_data.length, 40);        /* device tree in bytes */
    final_buffer.writeUInt32LE(0, 44);                          /* future expansion: should be 0 */
    final_buffer.write(this.name, 48, this.name.length > 16 ? 16 : this.name.length, 'ascii')               /* asciiz product name */
    final_buffer.write(this.cmdline, 64, this.name.length > 512 ? 512 : this.name.length, 'ascii')          /* cmdline */

    // TODO: Implement this
    // this.id.copy(final_buffer, 576, 0, this.id.length > 8 ? 8 : this.id.length);

    this.kernel_data.copy(final_buffer, 1 * this.page_size);
    this.ramdisk_data.copy(final_buffer, (1 + n) * this.page_size);
    this.second_data.copy(final_buffer, (1 + n + m) * this.page_size);
    this.dt_data.copy(final_buffer, (1 + n + m + o) * this.page_size);

    return final_buffer;
}
BootImg.prototype.fromParts = function(
    name, cmdline, page_size, tags_addr, 
    kernel_data, kernel_addr, ramdisk_data, ramdisk_addr, second_data, second_addr, dt_data) {

    this.kernel_addr = kernel_addr;
    this.ramdisk_addr = ramdisk_addr;
    this.second_addr = second_addr;
    this.tags_addr = tags_addr;
    this.page_size = page_size;
    this.name = name;
    this.cmdline = cmdline;

    this.kernel_data = new Buffer(kernel_data);
    this.ramdisk_data = new Buffer(ramdisk_data);
    this.second_data = new Buffer(second_data);
    this.dt_data = new Buffer(dt_data);
}

BootImg.prototype.fromBuffer = function(byte_buffer) {
    var kernel_size = byte_buffer.readUInt32LE(8),
        kernel_addr = byte_buffer.readUInt32LE(12),
        ramdisk_size = byte_buffer.readUInt32LE(16),
        ramdisk_addr = byte_buffer.readUInt32LE(20),
        second_size = byte_buffer.readUInt32LE(24),
        second_addr = byte_buffer.readUInt32LE(28),
        tags_addr = byte_buffer.readUInt32LE(32),
        page_size = byte_buffer.readUInt32LE(36),
        dt_size = byte_buffer.readUInt32LE(40),
        unused = byte_buffer.readUInt32LE(44),
        name = byte_buffer.slice(48, 48 + 16).toString().replace(/\u0000*$/, ''),
        cmdline = byte_buffer.slice(64, 64 + 512).toString().replace(/\u0000*$/, '');

    var n = Math.floor((kernel_size + page_size - 1) / page_size),
        m = Math.floor((ramdisk_size + page_size - 1) / page_size),
        o = Math.floor((second_size + page_size - 1) / page_size),
        p = Math.floor((dt_size + page_size - 1) / page_size);

    var kernel_data = byte_buffer.slice(1 * page_size, 1 * page_size + kernel_size),
        ramdisk_data = byte_buffer.slice((1 + n) * page_size, (1 + n) * page_size + ramdisk_size),
        second_data = byte_buffer.slice((1 + n + m) * page_size, (1 + n + m) * page_size + second_size),
        dt_data = byte_buffer.slice((1 + n + m + o) * page_size, (1 + n + m + o) * page_size + dt_size);

    this.fromParts(name, cmdline, page_size, tags_addr, kernel_data, kernel_addr, ramdisk_data, ramdisk_addr, second_data, second_addr, dt_data);
}

BootImg.prototype.print_info = function() {
    if(!this.validate) throw new Error('Invalid image buffer.');

    console.log("Kernel  " + this.kernel_data.length + " bytes at 0x" + zeroFill(this.kernel_addr.toString(16), 8));
    console.log("Ramdisk " + this.ramdisk_data.length + " bytes at 0x" + zeroFill(this.ramdisk_addr.toString(16), 8));
    console.log("Second  " + this.second_data.length + " bytes at 0x" + zeroFill(this.second_addr.toString(16), 8));
    console.log("Tags at 0x" + zeroFill(this.second_addr.toString(16), 8));
    console.log("Page size: " + this.page_size);
    console.log("DT size: " + this.dt_data.length + " bytes");
    console.log("Board name: " + this.name);
    console.log("Commandline: " + this.cmdline);
}

BootImg.prototype.extract = function(output_dir, prefix) {
    if(!this.validate) throw new Error('Invalid image buffer.');

    prefix = prefix || 'image';

    fs.writeFileSync(path.resolve(output_dir, prefix + "-kernel"), this.kernel_data);
    fs.writeFileSync(path.resolve(output_dir, prefix + "-ramdisk"), this.ramdisk_data);
    if(this.second_size) fs.writeFileSync(path.resolve(output_dir, prefix + "-second"), this.second_data);
    if(this.dt_size) fs.writeFileSync(path.resolve(output_dir, prefix + "-dt"), this.dt_data);

    var info_file_path = path.resolve(output_dir, prefix + "-info");

    fs.writeFileSync(info_file_path, "");
    fs.appendFileSync(info_file_path, "Kernel  " + this.kernel_data.length + " bytes at 0x" + zeroFill(this.kernel_addr.toString(16), 8) + "\n");
    fs.appendFileSync(info_file_path, "Ramdisk " + this.ramdisk_data.length + " bytes at 0x" + zeroFill(this.ramdisk_addr.toString(16), 8) + "\n");
    fs.appendFileSync(info_file_path, "Second  " + this.second_data.length + " bytes at 0x" + zeroFill(this.second_addr.toString(16), 8) + "\n");
    fs.appendFileSync(info_file_path, "Tags at 0x" + zeroFill(this.second_addr.toString(16), 8) + "\n");
    fs.appendFileSync(info_file_path, "Page size: " + this.page_size + "\n");
    fs.appendFileSync(info_file_path, "DT size: " + this.dt_data.length + " bytes" + "\n");
    fs.appendFileSync(info_file_path, "Board name: " + this.name + "\n");
    fs.appendFileSync(info_file_path, "Commandline: " + this.cmdline + "\n");
    console.log("Image info written to " + info_file_path);
}

function main_extract_bootimg() {    
    var imgfile = undefined,
        output = '.';

    for(var i = 2; i < process.argv.length; i ++) {
        if(process.argv[i] === '--output-dir')
            output = process.argv[++i];
        else {
            if(imgfile === undefined) imgfile = process.argv[i];
            else {
                console.log('Invalid commandline option: ' + process.argv[i]);
                return help();
            }
        }
    }
    if((!imgfile) || (typeof imgfile !== 'string') || 
        (imgfile.trim().length === 0) || (!fs.existsSync(imgfile)) ||
        (!fs.statSync(imgfile).isFile())) {
        console.log('Invalid image file: ' + imgfile);
        return 1;
    }
    if((!output) || (typeof output !== 'string') || 
        (output.trim().length === 0) || (!fs.existsSync(output)) ||
        (!fs.statSync(output).isDirectory())) {
        console.log('Invalid output directory: ' + output);
        return 1;
    }

    try { new BootImg(fs.readFileSync(imgfile)).extract(output, path.basename(imgfile)); }
    catch(e) { console.log('Invalid image file: ' + imgfile + '\n' + e.message); }
}

function main_extract_bootimg_info_only() {    
    var imgfile = undefined;

    for(var i = 2; i < process.argv.length; i ++) {
        if(imgfile === undefined) imgfile = process.argv[i];
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

    try { new BootImg(fs.readFileSync(imgfile)).print_info(); }
    catch(e) { console.log('Invalid image file: ' + imgfile + '\n' + e.message); }
}

function main_create_bootimg() {        
    var output_file = undefined,    // mandantory
        kernel = undefined,			// mandantory
        kernel_addr = 0x00008000,
        ramdisk = undefined,        // mandantory
        ramdisk_addr = 0x01000000,
        second = new Buffer(0),
        second_addr = 0x00f00000,
        tags_addr = 0x00000100,
        page_size = 2048,
        dt = new Buffer(0),
        board_name = "",
        cmdline = undefined;        // mandantory

    for(var i = 2; i < process.argv.length; i ++) {
        if(process.argv[i] === '--output-file')
            output_file =  process.argv[++i];
        else if(process.argv[i] === '--kernel') {
            try { kernel = fs.readFileSync(process.argv[++i]); }
            catch(e) { console.log('Cannot read kernel file, ' + e.message); return 1; }
        } else if(process.argv[i] === '--kernel-addr') {
            try { kernel_addr = parseInt(process.argv[++i]); }
            catch(e) { console.log('Cannot parse kernel address, ' + e.message); return 1; }
        } else if(process.argv[i] === '--ramdisk') {
            try { ramdisk = fs.readFileSync(process.argv[++i]); }
            catch(e) { console.log('Cannot read ramdisk file, ' + e.message); return 1; }
        } else if(process.argv[i] === '--ramdisk-addr') {
            try { ramdisk_addr = parseInt(process.argv[++i]); }
            catch(e) { console.log('Cannot parse ramdisk address, ' + e.message); return 1; }
        } else if(process.argv[i] === '--second') {
            try { second = fs.readFileSync(process.argv[++i]); }
            catch(e) { console.log('Cannot read second file, ' + e.message); return 1; }
        } else if(process.argv[i] === '--second-addr') {
            try { second_addr = parseInt(process.argv[++i]); }
            catch(e) { console.log('Cannot parse second address, ' + e.message); return 1; }
        } else if(process.argv[i] === '--tags-addr') {
            try { tags_addr = parseInt(process.argv[++i]); }
            catch(e) { console.log('Cannot parse tags address, ' + e.message); return 1; }
        } else if(process.argv[i] === '--page-size') {
            try { page_size = parseInt(process.argv[++i]); }
            catch(e) { console.log('Cannot parse page size, ' + e.message); return 1; }
        } else if(process.argv[i] === '--dt') {
            try { dt = fs.readFileSync(process.argv[++i]); }
            catch(e) { console.log('Cannot read dt file, ' + e.message); return 1; }
        } else if(process.argv[i] === '--board-name') board_name = process.argv[++i];
        else if(process.argv[i] === '--cmdline') cmdline = process.argv[++i];
        else {
            console.log('Invalid commandline option: ' + process.argv[i]);
            return help();
        }
    }

    if((!output_file)|| (typeof output_file !== 'string') || 
        (output_file.trim().length === 0) || (!fs.existsSync(path.dirname(output_file))) || 
        (!fs.statSync(path.dirname(output_file)).isDirectory())) {
        console.log('Invalid output path: ' + output_file);
        return 1;
    }    
    if((!kernel) || (!ramdisk) || (!cmdline)) {
        console.log('Missing parameter.');
        return help();
    }

    fs.writeFileSync(output_file, new BootImg("ANDROID!", board_name, cmdline, page_size, tags_addr, 
        kernel, kernel_addr, ramdisk, ramdisk_addr, second, second_addr, dt).toBuffer());
}

function main_modify_bootimg() {    
    var imgfile = undefined,        // mandantory
        output_file = undefined,
        kernel = undefined,    
        kernel_addr = undefined,
        ramdisk = undefined,    
        ramdisk_addr = undefined,
        second = undefined,
        second_addr = undefined,
        tags_addr = undefined,
        page_size = undefined,
        dt = undefined,
        board_name = undefined,
        cmdline = undefined;    

    for(var i = 2; i < process.argv.length; i ++) {
        if(process.argv[i] === '--output-file')
            output_file =  process.argv[++i];
        else if(process.argv[i] === '--kernel') {
            try { kernel = fs.readFileSync(process.argv[++i]); }
            catch(e) { console.log('Cannot read kernel file, ' + e.message); return 1; }
        } else if(process.argv[i] === '--kernel-addr') {
            try { kernel_addr = parseInt(process.argv[++i]); }
            catch(e) { console.log('Cannot parse kernel address, ' + e.message); return 1; }
        } else if(process.argv[i] === '--ramdisk') {
            try { ramdisk = fs.readFileSync(process.argv[++i]); }
            catch(e) { console.log('Cannot read ramdisk file, ' + e.message); return 1; }
        } else if(process.argv[i] === '--ramdisk-addr') {
            try { ramdisk_addr = parseInt(process.argv[++i]); }
            catch(e) { console.log('Cannot parse ramdisk address, ' + e.message); return 1; }
        } else if(process.argv[i] === '--second') {
            try { second = fs.readFileSync(process.argv[++i]); }
            catch(e) { console.log('Cannot read second file, ' + e.message); return 1; }
        } else if(process.argv[i] === '--second-addr') {
            try { second_addr = parseInt(process.argv[++i]); }
            catch(e) { console.log('Cannot parse second address, ' + e.message); return 1; }
        } else if(process.argv[i] === '--tags-addr') {
            try { tags_addr = parseInt(process.argv[++i]); }
            catch(e) { console.log('Cannot parse tags address, ' + e.message); return 1; }
        } else if(process.argv[i] === '--page-size') {
            try { page_size = parseInt(process.argv[++i]); }
            catch(e) { console.log('Cannot parse page size, ' + e.message); return 1; }
        } else if(process.argv[i] === '--dt') {
            try { dt = fs.readFileSync(process.argv[++i]); }
            catch(e) { console.log('Cannot read dt file, ' + e.message); return 1; }
        } else if(process.argv[i] === '--board-name') board_name = process.argv[++i];
        else if(process.argv[i] === '--cmdline') cmdline = process.argv[++i];
        else if(imgfile === undefined) imgfile = process.argv[i];
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
    if(output_file && ((typeof output_file !== 'string') || 
        (output_file.trim().length === 0) || (!fs.existsSync(path.dirname(output_file))) || 
        (!fs.statSync(path.dirname(output_file)).isDirectory()))) {
        console.log('Invalid output path: ' + output_file);
        return 1;
    }

    var bootimg = new BootImg(fs.readFileSync(imgfile));

	if(kernel !== undefined) bootimg.kernel_data = kernel;  
	if(kernel_addr !== undefined) bootimg.kernel_addr = kernel_addr;  
	if(ramdisk !== undefined) bootimg.ramdisk_data = ramdisk;
	if(ramdisk_addr !== undefined) bootimg.ramdisk_addr = ramdisk_addr;
	if(second !== undefined) bootimg.second_data = second;
	if(second_addr !== undefined) bootimg.second_addr = second_addr;
	if(tags_addr !== undefined) bootimg.tags_addr = tags_addr;
	if(page_size !== undefined) bootimg.page_size = page_size;
	if(dt !== undefined) bootimg.dt_data = dt;
	if(board_name !== undefined) bootimg.board_name = board_name;
	if(cmdline !== undefined) bootimg.cmdline = cmdline;

	if(output_file) {
		fs.writeFileSync(output_file, bootimg.toBuffer());
		console.log('Modified image at ' + output);
	} else {
		fs.writeFileSync(imgfile, bootimg.toBuffer());
		console.log('Modified image in-place ' + imgfile);
	}
}

function main_initrd_ops() {
    var imgfile = undefined,        // mandantory
        output_file = undefined,
        cmd_list = [ ],
        need_write = false;

    for(var i = 2; i < process.argv.length; i ++) {
    	switch(process.argv[i]) {
    		case '--output-file':
    			output_file =  process.argv[++i];
    			break;
    		case 'ls':
    		case 'list':
    			cmd_list.push({ cmd: 'ls', args: [ process.argv[++ i] ] });
    			break;
    		case 'cat':
    			cmd_list.push({ cmd: 'cat', args: [ process.argv[++ i] ] });
    			break;
    		case 'm':
    		case 'md':
    		case 'mkdir':
    			need_write = true;
    			cmd_list.push({ cmd: 'mkdir', args: [ process.argv[++ i] ] });
    			break;
    		case 'chown':
    			need_write = true;
    			cmd_list.push({ cmd: 'chown', args: [ process.argv[++ i], process.argv[++ i], process.argv[++ i] ] });
    			break;
    		case 'chmod':
    			need_write = true;
    			cmd_list.push({ cmd: 'chmod', args: [ process.argv[++ i], process.argv[++ i] ] });
    			break;
    		case 'a':
    		case 'add':
    		case 'p':
    		case 'put':
    			need_write = true;
    			cmd_list.push({ cmd: 'put', args: [ process.argv[++ i], process.argv[++ i] ] });
    			break;
    		case 'ln':
    		case 'link':
    			need_write = true;
    			cmd_list.push({ cmd: 'ln', args: [ process.argv[++ i], process.argv[++ i] ] });
    			break;
    		case 'r':
    		case 'rm':
    		case 'remove':
    			need_write = true;
    			cmd_list.push({ cmd: 'rm', args: [ process.argv[++ i] ] });
    			break;
    		default:
    			if(imgfile === undefined) imgfile = process.argv[i];
    			else {
		            console.log('Invalid commandline option: ' + process.argv[i]);
		            return help();
    			}
    	}
    }
    if((!imgfile) || (typeof imgfile !== 'string') || 
        (imgfile.trim().length === 0) || (!fs.existsSync(imgfile)) ||
        (!fs.statSync(imgfile).isFile())) {
        console.log('Invalid image file: ' + imgfile);
        return 1;
    }    
    if(output_file && ((typeof output_file !== 'string') || 
        (output_file.trim().length === 0) || (!fs.existsSync(path.dirname(output_file))) || 
        (!fs.statSync(path.dirname(output_file)).isDirectory()))) {
        console.log('Invalid output path: ' + output_file);
        return 1;
    }

    if(cmd_list.length >0 ) {
    	var bootimg = new BootImg(fs.readFileSync(imgfile));
        zlib.gunzip(bootimg.ramdisk_data, function(err, newc_data) {
            var tree = new initramfsman(newc_data);
            for(var i = 0; i < cmd_list.length; i ++)
                if(!tree[cmd_list[i].cmd].apply(tree, cmd_list[i].args)) {
                    console.log('Archive not modified.');
                    return 1;
                }
            if(need_write) {
            	if(output_file) {            		
		            zlib.gzip(tree.toBuffer(), function(err, gz_data) {
		            	bootimg.ramdisk_data = gz_data;
						fs.writeFileSync(output_file, bootimg.toBuffer());
						console.log('Modified image at ' + output);
		            });
				} else {          		
		            zlib.gzip(tree.toBuffer(), function(err, gz_data) {
		            	bootimg.ramdisk_data = gz_data;
						fs.writeFileSync(imgfile, bootimg.toBuffer());
						console.log('Modified image in-place ' + imgfile);
		            });
				}
            }
        })
    }
}

if(require.main === module) {
    switch(process.argv[2]) {
        case "e":
        case "extract":
            process.argv.splice(2, 1);
            main_extract_bootimg();
            break;
        case "i":
        case "info":
            process.argv.splice(2, 1);
            main_extract_bootimg_info_only();
            break;
        case "c":
        case "create":
            process.argv.splice(2, 1);
            main_create_bootimg();
            break;
        case "m":
        case "modify":
            process.argv.splice(2, 1);
            main_modify_bootimg();
            break;
        case "initrd":
            process.argv.splice(2, 1);
            main_initrd_ops();
            break;
        default: return help();
    }
} else module.exports = {
    examine_bootimg: examine_bootimg,
    create_bootimg: create_bootimg
}


// The bootimg.h:
//
//        /* tools/mkbootimg/bootimg.h
//        **
//        ** Copyright 2007, The Android Open Source Project
//        **
//        ** Licensed under the Apache License, Version 2.0 (the "License"); 
//        ** you may not use this file except in compliance with the License. 
//        ** You may obtain a copy of the License at 
//        **
//        **     http://www.apache.org/licenses/LICENSE-2.0 
//        **
//        ** Unless required by applicable law or agreed to in writing, software 
//        ** distributed under the License is distributed on an "AS IS" BASIS, 
//        ** WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. 
//        ** See the License for the specific language governing permissions and 
//        ** limitations under the License.
//        */
//
//        #ifndef _BOOT_IMAGE_H_
//        #define _BOOT_IMAGE_H_
//
//        typedef struct boot_img_hdr boot_img_hdr;
//
//        #define BOOT_MAGIC "ANDROID!"
//        #define BOOT_MAGIC_SIZE 8
//        #define BOOT_NAME_SIZE 16
//        #define BOOT_ARGS_SIZE 512
//
//        struct boot_img_hdr
//        {
//            unsigned char magic[BOOT_MAGIC_SIZE];
//
//            unsigned kernel_size;  /* size in bytes */
//            unsigned kernel_addr;  /* physical load addr */
//
//            unsigned ramdisk_size; /* size in bytes */
//            unsigned ramdisk_addr; /* physical load addr */
//
//            unsigned second_size;  /* size in bytes */
//            unsigned second_addr;  /* physical load addr */
//
//            unsigned tags_addr;    /* physical addr for kernel tags */
//            unsigned page_size;    /* flash page size we assume */
//            unsigned dt_size;      /* device tree in bytes */
//            unsigned unused;       /* future expansion: should be 0 */
//            unsigned char name[BOOT_NAME_SIZE]; /* asciiz product name */
//
//            unsigned char cmdline[BOOT_ARGS_SIZE];
//
//            unsigned id[8]; /* timestamp / checksum / sha1 / etc */
//        };
//
//        /*
//        ** +-----------------+ 
//        ** | boot header     | 1 page
//        ** +-----------------+
//        ** | kernel          | n pages  
//        ** +-----------------+
//        ** | ramdisk         | m pages  
//        ** +-----------------+
//        ** | second stage    | o pages
//        ** +-----------------+
//        ** | device tree     | p pages
//        ** +-----------------+
//        **
//        ** n = (kernel_size + page_size - 1) / page_size
//        ** m = (ramdisk_size + page_size - 1) / page_size
//        ** o = (second_size + page_size - 1) / page_size
//        ** p = (dt_size + page_size - 1) / page_size
//        **
//        ** 0. all entities are page_size aligned in flash
//        ** 1. kernel and ramdisk are required (size != 0)
//        ** 2. second is optional (second_size == 0 -> no second)
//        ** 3. load each element (kernel, ramdisk, second) at
//        **    the specified physical address (kernel_addr, etc)
//        ** 4. prepare tags at tag_addr.  kernel_args[] is
//        **    appended to the kernel commandline in the tags.
//        ** 5. r0 = 0, r1 = MACHINE_TYPE, r2 = tags_addr
//        ** 6. if second_size != 0: jump to second_addr
//        **    else: jump to kernel_addr
//        */
//
//        #if 0
//        typedef struct ptentry ptentry;
//        struct ptentry {
//            char name[16];      /* asciiz partition name    */
//            unsigned start;     /* starting block number    */
//            unsigned length;    /* length in blocks         */
//            unsigned flags;     /* set to zero              */
//        };
//        /* MSM Partition Table ATAG
//        **
//        ** length: 2 + 7 * n
//        ** atag:   0x4d534d70
//        **         <ptentry> x n
//        */
//        #endif
//
//        #endif