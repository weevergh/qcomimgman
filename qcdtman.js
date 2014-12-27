#!/usr/local/bin/node

var fs = require('fs'),
	path = require('path');

function padLeft( number, width, filler ) {
	filler = filler || ' ';
	width -= number.toString().length;
	if ( width > 0 )
		return new Array( width + (/\./.test( number ) ? 2 : 1) ).join( filler ) + number;
	return number + ""; // always return a string
}

function extract_portion(fd, pos, length, output) {
	function o(o_method, data) {
		if(typeof o_method === 'string') {
	    	try { fs.writeFileSync(o_method, b); }
	    	catch(err) {
	    	    console.log("Failed to write data: " + err.message);
	    	    return;
	    	}
	    	console.log("Extracted " + o_method);
		} else if(typeof o_method === 'function') o_method(data);
		else throw new Error('Invalid output method provided.');
	}
	if(length) {
		var b = new Buffer(length);
		fs.read(fd, b, 0, length, pos, function(err, bytesRead) {
	    	if(err) {
	    	    console.log("Failed to read data: " + e.message);
	    	    console.log("Possible corrupted image file.");
	    	    return;
	    	} else if(bytesRead != length) {
	    	    console.log("Failed to read data, only got " + bytesRead + ' bytes, expecting ' + length + '.');
	    	    return;
	    	} 
	    	o(output, b);
		});
	} else o(output, new Buffer(0));
}


function help() {
	console.log("Usage: " + process.argv[1] + " <info|extract|create> [args]");
	console.log("QCOM DT manipulation script.")
	console.log(" Functions:")
	console.log("  common");
	console.log("   --help/-h            this help screen");
	console.log("  info <input file>");
	console.log("   No available options");
	console.log("  extract [options] <input file>");
	console.log("   --output-dir/-o      output path, mandantory");
	console.log("  create [options] <dtb dir>");
	console.log("   --output-file/-o     output file, mandantory");
	console.log("   --page-size/-s       page size in bytes");
	console.log("   --dt-tag/-d          alternate QCDT_DT_TAG");
	console.log("   --force-v2/-2        use dtb v2 format");
}

var OF_DT_HEADER = 0xd00dfeed;
var OF_DT_BEGIN_NODE = 0x1;
var OF_DT_END_NODE = 0x2;
var OF_DT_PROP = 0x3;
var OF_DT_END = 0x9

function examine_dtb(file_path, cb, fincb) {
	fs.open(file_path, 'r', function(err, fd) {
	    if (err) {
	        console.log("Failed to read file: " + err.message);
	        return;
	    }
	    var header_size = 28,
	    	header = new Buffer(header_size);
	    fs.read(fd, header, 0, header_size, 0, function(e, bytesRead) {
	    	if(e) {
	    	    console.log("Failed to read header: " + e.message);
	    	    return;
	    	} else if(bytesRead != header_size) {
	    	    console.log("Failed to read header, only got " + bytesRead + ' bytes, expecting ' + header_size + '.');
	    	    return;
	    	} 
	    	// Parse the header with struct below.
	    	if(header.readUInt32BE(0) !== OF_DT_HEADER) {
	    	    console.log('Wrong magic header 0x' + header.readUInt32BE(0).toString(16) + ', expecting "0x' + OF_DT_HEADER.toString(16) + '".');
	    	    return;
	    	}
			var totalsize = header.readUInt32BE(4);
			var off_dt_struct = header.readUInt32BE(8);
			var off_dt_strings = header.readUInt32BE(12);
			var off_mem_rsvmap = header.readUInt32BE(16);
			var version = header.readUInt32BE(20);
			var last_comp_version = header.readUInt32BE(24);

			// console.log('Version: ' + version);
			// console.log('CompVer: ' + last_comp_version);
			// console.log('off_dt_struct: ' + off_dt_struct);
			// console.log('off_dt_strings: ' + off_dt_strings);
			// console.log('off_mem_rsvmap: ' + off_mem_rsvmap);
			// console.log();

			var off_dt_struct_prox_len = off_dt_strings - off_dt_struct;
			var off_dt_strings_prox_len = totalsize - off_dt_strings;

			extract_portion(fd, off_dt_struct, off_dt_struct_prox_len, function(dt_struct) {
				extract_portion(fd, off_dt_strings, off_dt_strings_prox_len, function(dt_strings) {
					function parse_node(start_idx) {
						if(dt_struct.readUInt32BE(start_idx) !== OF_DT_BEGIN_NODE) 
							throw new Error(OF_DT_BEGIN_NODE);
						var node_name,
							node_name_len = 0;
						do {
							node_name_len += 4;
							node_name = dt_struct.slice(start_idx + 4, start_idx + 4 + node_name_len).toString().replace(/\u0000*$/, '');
						} while(node_name.length === node_name_len);

						var pos = start_idx + 4 + node_name_len;

						while(dt_struct.readUInt32BE(pos) === OF_DT_PROP)
							pos += parse_prop(pos);						
						while(dt_struct.readUInt32BE(pos) === OF_DT_BEGIN_NODE)
							pos += parse_node(pos);

						if(dt_struct.readUInt32BE(pos) !== OF_DT_END_NODE)
							//throw new Error(JSON.stringify(dt_struct.slice(pos - 5, pos + 5)) + JSON.stringify(dt_struct.slice(pos, pos + 8)));
							throw new Error("Invalid DT");

						return pos + 4 - start_idx;
					}
					function parse_prop(start_idx) {
						if(dt_struct.readUInt32BE(start_idx) !== OF_DT_PROP)
							throw new Error(OF_DT_PROP);
						var value_size = dt_struct.readUInt32BE(start_idx + 4),
							name_offset = dt_struct.readUInt32BE(start_idx + 8),
							value = dt_struct.slice(start_idx + 12, start_idx + 12 + value_size),
							name = dt_strings.slice(name_offset).toString().split(/\u0000/)[0];
						if(typeof cb === 'function') cb(name, value);
						return Math.ceil(value_size / 4) * 4 + 12;
					}
					parse_node(0);
					if(typeof fincb === 'function') fincb();
				});
			});
		});
	});
}

function build_final_image(dtbs, output, dtb_version, page_size) {
	var result_buf = new Buffer([]),
		magic_buf = new Buffer('QCDT'),
		ver_buf = new Buffer(4),
		dtb_count_buf = new Buffer(4);

	var dtb_count = 0,
		dtb_entry_buffer = new Buffer(0),
		dtb_data_buffer = new Buffer(0),
		dtb_offset = 12,							/* Header size */
		dtb_data_offset = 0;
	dtbs.forEach(function(dtb) {
		dtb_count += dtb.info.length;

		dtb.offset = dtb_data_offset;
		dtb_data_offset += dtb.data.length;
		dtb_data_offset = Math.ceil(dtb_data_offset / page_size) * page_size;

		var dtb_data = new Buffer(dtb_data_offset - dtb.offset);
		dtb.data.copy(dtb_data, 0);
		dtb_data_buffer = Buffer.concat([dtb_data_buffer, dtb_data]);

		// platform
		// variant
		// subtype
		// rev
		// dtb offset
		// dtb size
		dtb.info.forEach(function(entry) {
			// dtb.offset this need calc offset later.
			if(dtb_version === 1) {
				var entry_buffer = new Buffer(20);
				entry_buffer.writeUInt32LE(entry.platform, 0);
				entry_buffer.writeUInt32LE(entry.variant, 4);
				entry_buffer.writeUInt32LE(entry.rev, 8);
				entry_buffer.writeUInt32LE(dtb.offset, 12);
				entry_buffer.writeUInt32LE(dtb.data.length, 16);
				dtb_entry_buffer = Buffer.concat([dtb_entry_buffer, entry_buffer]);
			} else if(dtb_version === 2) {
				var entry_buffer = new Buffer(24);
				entry_buffer.writeUInt32LE(entry.platform, 0);
				entry_buffer.writeUInt32LE(entry.variant, 4);
				entry_buffer.writeUInt32LE(entry.subtype, 8);
				entry_buffer.writeUInt32LE(entry.rev, 12);
				entry_buffer.writeUInt32LE(dtb.offset, 16);
				entry_buffer.writeUInt32LE(dtb.data.length, 20);
				dtb_entry_buffer = Buffer.concat([dtb_entry_buffer, entry_buffer]);
			} else throw new Error('Unknown DTB ver: ' + dtb_version);
		})
	});
	dtb_offset += dtb_entry_buffer.length + 4;
	dtb_offset = Math.ceil(dtb_offset / page_size) * page_size;

	var final_buffer = new Buffer(dtb_offset + dtb_data_offset);
	
	final_buffer.write('QCDT', 0);					/* Magic */
	final_buffer.writeUInt32LE(dtb_version, 4);		/* Version */
	final_buffer.writeUInt32LE(dtb_count, 8);		/* Num of DTB */
	dtb_entry_buffer.copy(final_buffer, 12);		/* DTB entries */
	/* DTB end */
	/* DTB entries padding */
	dtb_data_buffer.copy(final_buffer, dtb_offset);	/* DTB data */

	for(var i = 0; i < dtb_count; i ++) {
		if(dtb_version === 1)
			final_buffer.writeUInt32LE(final_buffer.readUInt32LE(12 + i * 20 + 12) + dtb_offset, 12 + i * 20 + 12);
		else if(dtb_version === 2) 
			final_buffer.writeUInt32LE(final_buffer.readUInt32LE(12 + i * 24 + 16) + dtb_offset, 12 + i * 24 + 16);
		else throw new Error('Unknown DTB ver: ' + dtb_version);
	}

	fs.writeFileSync(output, final_buffer);
}

function build_qcdt(input_path, output, search_dt_tag, search_board_tag, force_v2, page_size) {
	var dtbs = [ ],
		files = fs.readdirSync(input_path).filter(function(f) { return /^.*\.dtb$/.test(f); });
	files.forEach(function(file) {
		if(!file.match(/^.*\.dtb$/)) return;
		file = path.resolve(input_path, file);
		var dtb = {
				info: [ ],
				data: undefined
			},
			qcdt_msm_data = undefined,
			qcdt_board_data = undefined;
		examine_dtb(file, function(prop, value) {
			if(prop === search_dt_tag) qcdt_msm_data = value;
			else if(prop === search_board_tag) qcdt_board_data = value;
			else if(prop === 'model') console.log('Found ' + value + ', ' + path.basename(file));
		}, function() {
			if(qcdt_board_data !== undefined) dtb_version = 2;
			else if(dtb_version === undefined) dtb_version = 1;
			if(!qcdt_board_data) {
				for(var i = 0; i < qcdt_msm_data.length; i += 3 * 4) dtb.info.push({
					platform: qcdt_msm_data.readUInt32BE(i + 0),
					variant: qcdt_msm_data.readUInt32BE(i + 4),
					subtype: 0x0,
					rev: qcdt_msm_data.readUInt32BE(i + 8)
				});
			} else {
				for(var i = 0; i < qcdt_msm_data.length; i += 2 * 4) dtb.info.push({
					platform: qcdt_msm_data.readUInt32BE(i + 0),
					variant: qcdt_board_data.readUInt32BE(i + 0),
					subtype: qcdt_board_data.readUInt32BE(i + 4),
					rev: qcdt_msm_data.readUInt32BE(i + 4)
				});
			}
			dtb.data = fs.readFileSync(file);
			dtbs.push(dtb);
			if(dtbs.length === files.length) 
				build_final_image(dtbs, output, force_v2 ? 2 : dtb_version, page_size);
		});
	});
}

function examine_qcdt(file_path, extract, output_dir) {
	fs.open(file_path, 'r', function(err, fd) {
	    if (err) {
	        console.log("Failed to read file: " + err.message);
	        return;
	    }
	    var header_size = 12,
	    	header = new Buffer(header_size);
	    fs.read(fd, header, 0, header_size, 0, function(e, bytesRead) {
	    	if(e) {
	    	    console.log("Failed to read header: " + e.message);
	    	    return;
	    	} else if(bytesRead != header_size) {
	    	    console.log("Failed to read header, only got " + bytesRead + ' bytes, expecting ' + header_size + '.');
	    	    return;
	    	} 
	    	// Parse the header with struct below.
	    	if(header.slice(0, 4).toString() !== 'QCDT') {
	    	    console.log('Wrong magic header ' + header.slice(0, 4).toJSON() + ', expecting "QCDT".');
	    	    return;
	    	}
			var qcdt_ver = header.readUInt32LE(4);
			var dt_num = header.readUInt32LE(8);

			console.log("");
			console.log("QCDT Version:  " + qcdt_ver);
			console.log("Number of DTs:  " + dt_num);
			console.log("");

			var current_pos = 12,
				current_dt_num = 0;

			function check_dt_info(dt_idx) {
				if(dt_idx >= dt_num) return;
				if(qcdt_ver === 1) extract_portion(fd, 12 + 20 * dt_idx, 20, function(entry) {
					var platform_id = entry.readUInt32LE(0);
					var variant_id = entry.readUInt32LE(4);
					var soc_rev = entry.readUInt32LE(8);
					var offset = entry.readUInt32LE(12);
					var size = entry.readUInt32LE(16);
					console.log("DT " + padLeft((++dt_idx), 3) + ": Platform 0x" + padLeft(platform_id.toString(16), 2, '0') + " Variant 0x" + padLeft(variant_id.toString(16), 2, '0') + " SOC Rev 0x" + soc_rev.toString(16));
					if(extract) extract_portion(fd, offset, size, path.resolve(output_dir, dt_idx + ".dtb"));
					check_dt_info(dt_idx);
				}); else if(qcdt_ver === 2) extract_portion(fd, 12 + 24 * dt_idx, 24, function(entry) {
					var platform_id = entry.readUInt32LE(0);
					var variant_id = entry.readUInt32LE(4);
					var subtype = entry.readUInt32LE(8);
					var soc_rev = entry.readUInt32LE(12);
					var offset = entry.readUInt32LE(16);
					var size = entry.readUInt32LE(20);
					console.log("DT " + padLeft((++dt_idx), 3) + ": Platform 0x" + padLeft(platform_id.toString(16), 2, '0') + " Variant 0x" + padLeft(variant_id.toString(16), 2, '0') + " Sub Type 0x" + padLeft(subtype.toString(16), 2, '0') + " SOC Rev 0x" + soc_rev.toString(16));
					if(extract) extract_portion(fd, offset, size, path.resolve(output_dir, dt_idx + ".dtb"));
					check_dt_info(dt_idx);
				}); else console.log("Unsupported QCDT version.");
			}

			check_dt_info(0);
	    });
	});
}

function main_create_dt() {
	var input_path = undefined,
		output = undefined,
		page_size = 2048,
		force_v2 = false,
		search_dt_tag = 'qcom,msm-id',
		search_board_tag = 'qcom,board-id';
		dtb_version = undefined;

	for(var i = 2; i < process.argv.length; i ++) {
		if((process.argv[i] === '-d') || ((process.argv[i] === '--dt-tag')))
			search_dt_tag = process.argv[++i];
		else if((process.argv[i] === '-o') || ((process.argv[i] === '--output-file')))
			output = process.argv[++i];
		else if((process.argv[i] === '-s') || ((process.argv[i] === '--page-size')))
			page_size = parseInt(process.argv[++i]);
		else if((process.argv[i] === '-2') || ((process.argv[i] === '--force-v2')))
			force_v2 = true;
		else if((process.argv[i] === '-h') || ((process.argv[i] === '--help')))
			return help();
		else {
			if(input_path === undefined) input_path = process.argv[i];
			else {
				console.log('Invalid commandline option: ' + process.argv[i]);
				return help();
			}
		}
	}

	if(!input_path) {
		console.log('Using current directory as input path.');
		input_path = input_path || '.';
	}
	if(!output) {
		output = path.resolve('dt.img');
		if(fs.existsSync(output)) {
			 console.log('Default output path ' + output + ' exists.');
			 console.log('Abort.');
			 return help();
		} else console.log('Using ' + output + ' as output file.');
	}

	if((!input_path) || (typeof input_path !== 'string') || 
		(input_path.trim().length === 0) || (!fs.existsSync(input_path)) ||
		(!fs.statSync(input_path).isDirectory())) {
		console.log('Invalid input directory: ' + input_path);
		return help();
	}

	if((!output) || (typeof output !== 'string') || 
		(output.trim().length === 0) || (!fs.existsSync(path.dirname(output))) ||
		(!fs.statSync(path.dirname(output)).isDirectory())) {
		console.log('Invalid output directory: ' + path.dirname(output));
		return help();
	}
	if(fs.existsSync(output)) {
		if(fs.statSync(output).isDirectory()) {
			console.log('Invalid output path: ' + output);
			return help();
		} else console.log('Warning: Will overwrite existing output file ' + output);
	}

	build_qcdt(input_path, output, search_dt_tag, search_board_tag, force_v2, page_size);
}

function main_extract_dt() {
	var imgfile = undefined,
		output = '.';

	for(var i = 2; i < process.argv.length; i ++) {
		if((process.argv[i] === '-o') || ((process.argv[i] === '--output-dir')))
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
		console.log('Invalid output path: ' + output);
		return 1;
	}

	examine_qcdt(imgfile, true, output);
}

function main_extract_dt_info_only() {
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
	examine_qcdt(imgfile, false, undefined);
}

if(require.main === module) {
	switch(process.argv[2]) {
		case 'c':
		case 'create':
			process.argv.splice(2, 1);
			main_create_dt();
			break;
		case 'e':
		case 'extract':
			process.argv.splice(2, 1);
			main_extract_dt();
			break;
		case 'i':
		case 'info':
			process.argv.splice(2, 1);
			main_extract_dt_info_only();
			break;
		default: return help();
	}
} else module.exports = {
	examine_qcdt: examine_qcdt,
	build_qcdt: build_qcdt
}


 //                               size
 //   x      +------------------+
 //   |      | MAGIC ("QCDT")   |   4B
 //   |      +------------------+
 // header   | VERSION          |   uint32 (initial version 1)
 //   |      +------------------+
 //   |      | num of DTBs      |   uint32 (number of DTB entries)
 //   x      +------------------+
 //   |      | platform id #1   |   uint32 (e.g. ID for MSM8974)
 //   |      +------------------+
 //   |      | variant id #1    |   uint32 (e.g. ID for CDP, MTP)
 // device   +------------------+
 //  #1      | soc rev #1       |   uint32 (e.g. MSM8974 v2)
 // entry    +------------------+
 //   |      | offset #1        |   uint32 (byte offset from start/before MAGIC
 //   |      +------------------+           to DTB entry)
 //   |      | size #1          |   uint32 (size in bytes of DTB blob)
 //   x      +------------------+
 //   .              .
 //   .              .  (repeat)
 //   .              .

 //   x      +------------------+
 //   |      | platform id #Z   |   uint32 (e.g. ID for MSM8974)
 //   |      +------------------+
 //  device  | variant id #Z    |   uint32 (e.g. ID for CDP, MTP)
 //  #Z      +------------------+
 //  entry   | soc rev #Z       |   uint32 (e.g. MSM8974 v2)
 //  (last)  +------------------+
 //   |      | offset #Z        |   uint32 (byte offset from start/before MAGIC
 //   x      +------------------+           to DTB entry)
 //          | 0 ("zero")       |   uint32 (end of list delimiter)
 //          +------------------+           to DTB entry)
 //          | padding          |   variable length for next DTB to start on
 //          +------------------+           page boundary
 //          | DTB #1           |   variable (start is page aligned)
 //          |                  |
 //          |                  |
 //          +------------------+
 //          | padding          |   variable length for next DTB to start on
 //          +------------------+           page boundary
 //                  .
 //                  .
 //                  .

 //          +------------------+
 //          | DTB #Z (last)    |   variable (start is page aligned)
 //          |                  |
 //          |                  |
 //          +------------------+