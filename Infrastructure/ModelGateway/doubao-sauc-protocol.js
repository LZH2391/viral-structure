const { gzipSync, gunzipSync } = require("zlib");
const {
  COMPRESSION_GZIP,
  DEFAULT_PROTOCOL_VERSION,
  HEADER_SIZE_BYTES,
  HEADER_SIZE_UNITS,
  MESSAGE_FLAGS,
  MESSAGE_TYPES,
  SERIALIZATION_JSON,
  SERIALIZATION_NONE,
} = require("./doubao-sauc-constants");

function encodeClientRequest({ event, connectId, requestId, credentials, audioChunk, isLast }) {
  const payload = event === "full_client_request"
    ? buildFullClientPayload({ connectId, requestId, credentials, audioChunk, isLast })
    : buildAudioOnlyPayload({ audioChunk, isLast });
  const payloadBytes = event === "full_client_request"
    ? gzipSync(Buffer.from(JSON.stringify(payload), "utf8"))
    : gzipSync(Buffer.from(audioChunk ?? Buffer.alloc(0)));
  const header = buildBinaryHeader({
    messageType: event === "full_client_request" ? MESSAGE_TYPES.fullClientRequest : MESSAGE_TYPES.audioOnlyRequest,
    messageTypeFlags: event === "audio_only_request" && isLast ? MESSAGE_FLAGS.lastPacket : MESSAGE_FLAGS.none,
    serializationMethod: event === "full_client_request" ? SERIALIZATION_JSON : SERIALIZATION_NONE,
    compression: COMPRESSION_GZIP,
  });
  const payloadSize = Buffer.alloc(4);
  payloadSize.writeUInt32BE(payloadBytes.length, 0);
  return Buffer.concat([header, payloadSize, payloadBytes]);
}

function buildFullClientPayload({ connectId, requestId, credentials, audioChunk, isLast }) {
  return {
    user: { uid: connectId },
    audio: {
      format: credentials.audio.format,
      codec: credentials.audio.codec,
      rate: credentials.audio.rate,
      bits: credentials.audio.bits,
      channel: credentials.audio.channel,
      data: Buffer.from(audioChunk ?? Buffer.alloc(0)).toString("base64"),
    },
    request: {
      reqid: requestId,
      model_name: credentials.modelName,
      show_utterances: true,
      enable_nonstream: false,
      sequence: isLast ? -1 : 1,
    },
  };
}

function buildAudioOnlyPayload({ audioChunk, isLast }) {
  return {
    audioChunk: Buffer.from(audioChunk ?? Buffer.alloc(0)),
    isLast,
  };
}

function decodeServerMessage(buffer) {
  const bytes = Buffer.from(buffer ?? Buffer.alloc(0));
  if (bytes.length < HEADER_SIZE_BYTES + 8) throw new Error("server packet too short");
  const header = decodeBinaryHeader(bytes);
  const offset = header.headerSize;
  if (header.messageType === MESSAGE_TYPES.errorResponse) {
    const errorCode = bytes.readUInt32BE(offset);
    const payloadSize = bytes.readUInt32BE(offset + 4);
    const body = bytes.subarray(offset + 8, offset + 8 + payloadSize);
    const payload = decodePayloadBody(body, header.serializationMethod, header.compression);
    return {
      payload,
      headers: payload?.header || payload?.headers || null,
      isFinal: true,
      messageType: header.messageType,
      errorCode,
      sequence: null,
    };
  }
  const sequence = bytes.readInt32BE(offset);
  const payloadSize = bytes.readUInt32BE(offset + 4);
  const body = bytes.subarray(offset + 8, offset + 8 + payloadSize);
  const payload = decodePayloadBody(body, header.serializationMethod, header.compression);
  return {
    payload,
    headers: payload?.header || payload?.headers || null,
    isFinal: isFinalResponse(payload, header, sequence),
    messageType: header.messageType,
    errorCode: null,
    sequence,
  };
}

function isFinalResponse(payload, header = null, sequence = null) {
  if (header?.messageType === MESSAGE_TYPES.fullServerResponse && header.messageTypeFlags === MESSAGE_FLAGS.lastPacketWithSequence) return true;
  if (Number.isFinite(sequence) && sequence < 0) return true;
  if (!payload || typeof payload !== "object") return false;
  if (payload.is_final === true || payload.is_final === 1) return true;
  if (payload.result?.is_final === true || payload.result?.is_final === 1) return true;
  if (payload.result?.sequence === -1 || payload.sequence === -1) return true;
  return false;
}

function buildBinaryHeader({ messageType, messageTypeFlags, serializationMethod, compression }) {
  const header = Buffer.alloc(HEADER_SIZE_BYTES);
  header.writeUInt8(((DEFAULT_PROTOCOL_VERSION & 0x0f) << 4) | (HEADER_SIZE_UNITS & 0x0f), 0);
  header.writeUInt8(((messageType & 0x0f) << 4) | (messageTypeFlags & 0x0f), 1);
  header.writeUInt8(((serializationMethod & 0x0f) << 4) | (compression & 0x0f), 2);
  header.writeUInt8(0, 3);
  return header;
}

function decodeBinaryHeader(buffer) {
  const first = buffer.readUInt8(0);
  const second = buffer.readUInt8(1);
  const third = buffer.readUInt8(2);
  const headerSize = (first & 0x0f) * 4;
  return {
    protocolVersion: (first >> 4) & 0x0f,
    headerSize,
    messageType: (second >> 4) & 0x0f,
    messageTypeFlags: second & 0x0f,
    serializationMethod: (third >> 4) & 0x0f,
    compression: third & 0x0f,
  };
}

function decodePayloadBody(body, serializationMethod, compression) {
  const payloadBytes = compression === COMPRESSION_GZIP ? gunzipSync(body) : body;
  if (!payloadBytes.length) return {};
  if (serializationMethod === SERIALIZATION_JSON) return JSON.parse(payloadBytes.toString("utf8"));
  return { raw: payloadBytes.toString("utf8") };
}

module.exports = {
  buildAudioOnlyPayload,
  buildFullClientPayload,
  decodeServerMessage,
  encodeClientRequest,
};
