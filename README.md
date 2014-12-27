qcomimgman
==========
```
Usage:
initramfsman.js <tree|ls|cat|create|modify> [args]
Simple initramfs(gzipped cpio newc archive) manipulation script.
 Functions:
  tree <image file> [max dump level]
  ls <image file> [target path]
  cat <image file> <target file>
  create <input dir> <output file>
  modify <image file> [commands]
   command syntax:
    mkdir <archive path>
    chown <archive path> <uid> <gid>
    chmod <archive path> <access mode in 4 digit, ex. 4755 would translate to srwxr-xr-x>
    put <local file> <archive file>
    link <source path> <archive path>
    remove <archive file/directory>
```
```
Usage:
qcbootimgman.js <info|extract|create|modify|initrd> [args]
QCOM boot/recovery image manipulation script.
 Functions:
  common:
   --help            this help screen
  info <input file>
  extract [options] <input file>
   --output-dir      output path, mandantory
  create [options]
   --output-file     output file, mandantory
   --kernel          kernel file, mandantory
   --kernel-addr   kernel load addr
   --ramdisk         ramdisk file, mandantory
   --ramdisk-addr  ramdisk load addr
   --second          second file
   --second-addr   second load addr
   --tags-addr     tags load addr
   --page-size       page size in bytes
   --dt              dt file
   --board-name      board name
   --cmdline         kernel cmdline, mandantory
  modify [options] <input file>
   --output-file     output file, modify in place if omitted
   --kernel          replacement kernel file
   --kernel-addr   replacement kernel load addr
   --ramdisk         replacement ramdisk file
   --ramdisk-addr  replacement ramdisk load addr
   --second          replacement second file
   --second-addr   replacement second load addr
   --tags-addr     replacement tags load addr
   --page-size       replacement page size in bytes
   --dt              replacement dt file
   --board-name      replacement board name
   --cmdline         replacement kernel cmdline
  initrd [options] <input file> [commands]
    option:
      --output-file output file, modify in place if omitted
    command:
      ls [target path]
      cat <target file>
      mkdir <initrd path>
      chown <initrd path> <uid> <gid>
      chmod <initrd path> <access mode in 4 digit, ex. 4755 would translate to srwxr-xr-x>
      put <local file> <initrd file>
      link <source path> <initrd path>
      remove <initrd file/directory>
```
```
Usage: qcdtman.js <info|extract|create> [args]
QCOM DT manipulation script.
 Functions:
  common
   --help/-h            this help screen
  info <input file>
   No available options
  extract [options] <input file>
   --output-dir/-o      output path, mandantory
  create [options] <dtb dir>
   --output-file/-o     output file, mandantory
   --page-size/-s       page size in bytes
   --dt-tag/-d          alternate QCDT_DT_TAG
   --force-v2/-2        use dtb v2 format
```
