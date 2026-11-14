// Apple pasteboard records, shared by text, image and rich-text clipboard data.
export const MAX_CLIPBOARD_BYTES = 20 * 1024 * 1024;
export const CLIPBOARD_TYPES = new Set(['public.utf8-plain-text', 'public.png', 'public.tiff', 'public.rtf', 'public.html']);
export function parsePasteboard(data) {
    if (data.length > MAX_CLIPBOARD_BYTES + 65536) throw Error('Clipboard is too large');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength), decoder = new TextDecoder();
    let offset = 0;
    const integer = () => { if (offset + 4 > data.length) throw Error('Truncated clipboard'); const n = view.getUint32(offset); offset += 4; return n; };
    const bytes = length => { if (length > data.length - offset) throw Error('Truncated clipboard data'); const result = data.subarray(offset, offset + length); offset += length; return result; };
    const count = integer(); if (count > 256) throw Error('Too many clipboard formats');
    const formats = []; let total = 0;
    for (let i = 0; i < count; i++) {
        const type = decoder.decode(bytes(integer())); integer();
        const props = integer(); if (props > 256) throw Error('Too many clipboard properties');
        for (let j = 0; j < props; j++) { bytes(integer()); bytes(integer()); }
        const value = bytes(integer());
        if (CLIPBOARD_TYPES.has(type) && !formats.some(f => f.type === type)) {
            total += value.length; if (total > MAX_CLIPBOARD_BYTES) throw Error('Clipboard is too large');
            formats.push({type, data: new Uint8Array(value)});
        }
    }
    // Unsupported formats must not clear a useful local clipboard.
    return count > 0 && formats.length === 0 ? null : formats;
}
export function buildPasteboard(formats) {
    if (formats.length > CLIPBOARD_TYPES.size) throw Error('Too many clipboard formats');
    const encoder = new TextEncoder(), seen = new Set();
    let bytes = 0;
    const records = formats.map(({type, data}) => {
        if (!CLIPBOARD_TYPES.has(type) || seen.has(type)) throw Error('Unsupported clipboard format');
        seen.add(type); bytes += data.length;
        if (bytes > MAX_CLIPBOARD_BYTES) throw Error('Clipboard is too large');
        return {name: encoder.encode(type), data};
    });
    const result = new Uint8Array(4 + records.reduce((n, r) => n + 16 + r.name.length + r.data.length, 0));
    const view = new DataView(result.buffer); let offset = 0;
    const integer = n => { view.setUint32(offset, n); offset += 4; };
    integer(records.length);
    for (const r of records) {
        integer(r.name.length); result.set(r.name, offset); offset += r.name.length;
        integer(0); integer(0); integer(r.data.length); result.set(r.data, offset); offset += r.data.length;
    }
    return result;
}
