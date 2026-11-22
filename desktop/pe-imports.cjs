const { open } = require('node:fs/promises');

const machines = new Map([[0x014c, 'x86'], [0x8664, 'x64'], [0xaa64, 'arm64']]);
const dllName = /^[a-z0-9_][a-z0-9_. ()+-]{0,123}\.dll$/i;

async function withPe(file, scan) {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('请选择 Windows EXE 文件。');
    async function read(offset, length) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > info.size) throw new Error('EXE 文件结构无效。');
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead !== length) throw new Error('EXE 文件已变更。');
      return buffer;
    }
    const dos = await read(0, 64);
    if (dos.readUInt16LE() !== 0x5a4d) throw new Error('请选择有效的 Windows EXE 文件。');
    const position = dos.readUInt32LE(0x3c);
    const signature = await read(position, 24);
    const architecture = machines.get(signature.readUInt16LE(4));
    if (signature.readUInt32LE() !== 0x4550 || !architecture) throw new Error('此 Windows 程序的架构暂不支持。');
    return await scan(read, position, signature, architecture);
  } finally {
    await handle.close();
  }
}

const architectureOf = (file) => withPe(file, (_read, _position, _header, architecture) => architecture);

function importedLibraries(file) {
  return withPe(file, async (read, position, header, architecture) => {
    const sectionCount = header.readUInt16LE(6);
    const optionalSize = header.readUInt16LE(20);
    if (sectionCount > 96 || optionalSize < 96 || optionalSize > 4096) throw new Error('EXE 导入表无效。');
    const optional = await read(position + 24, optionalSize);
    const format = optional.readUInt16LE();
    const directory = format === 0x10b ? 96 : format === 0x20b ? 112 : 0;
    if (!directory || directory > optional.length) throw new Error('EXE 导入表无效。');
    const number = optional.readUInt32LE(directory - 4);
    const headerSize = optional.readUInt32LE(60);
    const bytes = await read(position + 24 + optionalSize, sectionCount * 40);
    const sections = Array.from({ length: sectionCount }, (_, index) => {
      const start = index * 40;
      return {
        rva: bytes.readUInt32LE(start + 12), length: bytes.readUInt32LE(start + 16),
        offset: bytes.readUInt32LE(start + 20),
      };
    });
    function mapped(address, length) {
      if (address < headerSize && address + length <= headerSize) return address;
      const section = sections.find(({ rva, length: size }) => address >= rva && address - rva + length <= size);
      if (!section) throw new Error('EXE 导入表指向无效位置。');
      return section.offset + address - section.rva;
    }

    const names = new Set();
    for (const [index, descriptorSize, nameOffset] of [[1, 20, 12], [13, 32, 4]]) {
      const offset = directory + index * 8;
      if (index >= number || offset + 8 > optional.length) continue;
      const start = optional.readUInt32LE(offset);
      const size = optional.readUInt32LE(offset + 4);
      if (!start || !size) continue;
      for (let entry = 0; entry < Math.min(256, Math.floor(size / descriptorSize)); entry++) {
        const record = await read(mapped(start + entry * descriptorSize, descriptorSize), descriptorSize);
        const nameAddress = record.readUInt32LE(nameOffset);
        if (!nameAddress) break;
        if (index === 13 && !(record.readUInt32LE() & 1)) continue;
        const nameBytes = [];
        for (let i = 0; i < 128; i++) {
          const [byte] = await read(mapped(nameAddress + i, 1), 1);
          if (!byte) break;
          nameBytes.push(byte);
        }
        const name = Buffer.from(nameBytes).toString('latin1');
        if (dllName.test(name)) names.add(name.toLowerCase());
      }
    }
    return { architecture, names: [...names] };
  });
}

module.exports = { importedLibraries, architectureOf, dllName };
