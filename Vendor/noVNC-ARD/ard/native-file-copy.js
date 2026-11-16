import Inflator from '../../noVNC/core/inflator.js';

// Native mouse events identify the viewer that owns a Mac drag. The legacy
// RFB pointer message moves the cursor but does not establish that ownership.
export function buildDropPointer(x, y, mask, timestamp) {
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > 32767 || y > 32767 || (mask !== 0 && mask !== 1)) throw Error('Invalid Mac drop coordinates');
    const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
    view.setUint32(6, timestamp >>> 0);
    bytes[10] = 0xff; bytes[11] = mask;
    view.setUint16(12, Math.floor(x)); view.setUint16(14, Math.floor(y));
    return bytes;
}
export function dropPointerCoordinates(displays, selected, x, y) {
    let display = displays.find(d => d.id === selected);
    if (!display && displays.length > 1) {
        display = displays.find(d => x >= d.fbX && y >= d.fbY && x < d.fbX + d.w && y < d.fbY + d.h);
        if (!display) throw Error('Drop onto a Mac display, rather than the space between displays.');
        const scale = display.scale > 0 ? display.scale : 1;
        return {x: display.x + (x - display.fbX) / scale - Math.min(...displays.map(d => d.x)),
                y: display.y + (y - display.fbY) / scale - Math.min(...displays.map(d => d.y))};
    }
    display ||= displays[0];
    const scale = display?.scale > 0 ? display.scale : 1;
    return {x: x / scale, y: y / scale};
}

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
        this.dispatchEvent(new CustomEvent('ardfileoffer', {detail: {session: v.getUint32(3), path}}));
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
