import Inflator from '../../noVNC/core/inflator.js';

export function handleFileCopy() {
    if (this._sock.rQwait('FileCopy header', 5)) return false;
    const h = this._sock.rQpeekBytes(5);
    const size = new DataView(h.buffer, h.byteOffset, h.byteLength).getUint32(1);
    if (size < 8 || size > 1024 * 1024) { this._fail('Invalid Mac file-copy message size'); return false; }
    if (this._sock.rQwait('FileCopy payload', 5 + size)) return false;
    this._sock.rQskipBytes(5);
    const data = new Uint8Array(this._sock.rQshiftBytes(size));
    this.dispatchEvent(new CustomEvent('ardfilecopy', {detail: {data}}));
    return true;
}
export function handleFileOffer() {
    if (this._sock.rQwait('FileOffer header', 11)) return false;
    const h = this._sock.rQpeekBytes(11), v = new DataView(h.buffer, h.byteOffset, h.byteLength);
    const size = v.getUint32(7);
    if (size > 32000) { this._fail('Invalid Mac file offer size'); return false; }
    if (this._sock.rQwait('FileOffer payload', 11 + size)) return false;
    this._sock.rQskipBytes(11);
    try {
        const path = new TextDecoder('utf-8', {fatal: true}).decode(this._sock.rQshiftBytes(size)).replace(/\0$/, '');
        this.dispatchEvent(new CustomEvent('ardfileoffer', {detail: {path}}));
    } catch { this._fail('Invalid Mac file offer'); return false; }
    return true;
}
// Drag offers share the clipboard envelope, NOT an 8-byte session/length header.
// [type=0x20][pad:3][session:u32be][uncompressed:u32be][compressed:u32be][zlib]
export function handleServerDrag() {
    if (this._sock.rQwait('DragOffer header', 15)) return false;
    const h = this._sock.rQpeekBytes(15), view = new DataView(h.buffer, h.byteOffset, h.byteLength);
    const unpacked = view.getUint32(7), packed = view.getUint32(11);
    if (unpacked > 1024 * 1024 || packed > 1024 * 1024) { this._fail('Mac drag offer is too large'); return false; }
    if (this._sock.rQwait('DragOffer payload', 15 + packed)) return false;
    this._sock.rQskipBytes(15);
    const bytes = this._sock.rQshiftBytes(packed);
    if (packed && unpacked) {
        try {
            const decoder = new Inflator(); decoder.setInput(bytes);
            const data = new Uint8Array(decoder.inflate(unpacked));
            this.dispatchEvent(new CustomEvent('ardfiledrag', {detail: {data}}));
        } catch { /* A drag without usable file paths leaves manual transfers available. */ }
    }
    return true;
}
