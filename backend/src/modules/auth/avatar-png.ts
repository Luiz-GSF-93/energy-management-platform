import { BadRequestException } from "@nestjs/common";
import { inflateSync } from "node:zlib";
// Accept a bounded, static RGBA thumbnail. Discard metadata; reject active formats.
export function validateAvatar(value: string): string {
  if (!value) return "";
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value))
    throw new BadRequestException("Use uma imagem PNG.");
  const b = Buffer.from(value.slice(22), "base64");
  if (
    b.length > 60000 ||
    !b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new BadRequestException("Imagem inválida ou muito grande.");
  const chunks: Buffer[] = [],
    image: Buffer[] = [];
  let offset = 8,
    width = 0,
    height = 0,
    ended = false;
  function crc(data: Buffer) {
    let n = 0xffffffff;
    for (const v of data) {
      n ^= v;
      for (let j = 0; j < 8; j++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
    }
    return (n ^ 0xffffffff) >>> 0;
  }
  while (offset + 12 <= b.length) {
    const length = b.readUInt32BE(offset),
      end = offset + 12 + length;
    if (end > b.length) throw new BadRequestException("Imagem incompleta.");
    const type = b.toString("ascii", offset + 4, offset + 8),
      data = b.subarray(offset + 8, offset + 8 + length);
    if (crc(b.subarray(offset + 4, end - 4)) !== b.readUInt32BE(end - 4))
      throw new BadRequestException("Imagem corrompida.");
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13)
        throw new BadRequestException("Imagem inválida.");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (
        width < 1 ||
        height < 1 ||
        width > 256 ||
        height > 256 ||
        data[8] !== 8 ||
        data[9] !== 6 ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      )
        throw new BadRequestException(
          "Use uma miniatura PNG RGBA até 256 pixels.",
        );
    }
    if (type === "IDAT") image.push(data);
    if (["IHDR", "IDAT", "IEND"].includes(type))
      chunks.push(b.subarray(offset, end));
    else if (
      type === "acTL" ||
      type === "fcTL" ||
      type === "fdAT" ||
      (type.charCodeAt(0) & 32) === 0
    )
      throw new BadRequestException("Use uma imagem estática.");
    offset = end;
    if (type === "IEND") {
      if (length !== 0 || offset !== b.length)
        throw new BadRequestException("Imagem inválida.");
      ended = true;
      break;
    }
  }
  if (!ended || !width || !image.length)
    throw new BadRequestException("Imagem incompleta.");
  try {
    const raw = inflateSync(Buffer.concat(image), {
      maxOutputLength: 256 * (256 * 4 + 1),
    });
    if (raw.length !== height * (width * 4 + 1)) throw new Error();
    for (let row = 0; row < height; row++)
      if (raw[row * (width * 4 + 1)] > 4) throw new Error();
  } catch {
    throw new BadRequestException("Imagem inválida.");
  }
  return (
    "data:image/png;base64," +
    Buffer.concat([b.subarray(0, 8), ...chunks]).toString("base64")
  );
}
