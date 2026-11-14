/*
 * noVNC-ARD: ARD MVS bitstream reader (MSB-first).
 * A small bit reservoir avoids per-bit bounds checks and method calls when
 * reading coefficients. At most 31 valid bits are held, so shifts are exact.
 */
export default class MvsBitstream {
    constructor(data, offset, length) {
        this._data = data;
        this._offset = offset;
        this._length = length;
        this._bytePos = 0;
        this._buffer = 0;
        this._available = 0;
    }
    get position() { return this._bytePos * 8 - this._available; }
    seek(position) {
        if (!Number.isInteger(position) || position < 0 || position > this._length * 8) throw new Error('MvsBitstream: invalid position');
        this._bytePos = position >> 3; this._available = 0; this._buffer = 0;
        if (position & 7) this.readBits(position & 7);
    }
    remainingBits() { return (this._length - this._bytePos) * 8 + this._available; }
    readBit() {
        if (this._available === 0) {
            if (this._bytePos >= this._length) throw new Error('MvsBitstream: read past end');
            this._buffer = this._data[this._offset + this._bytePos++];
            this._available = 8;
        }
        return (this._buffer >>> --this._available) & 1;
    }
    peekBits(n) {
        if (n > this.remainingBits()) throw new Error('MvsBitstream: read past end');
        while (this._available < n) {
            this._buffer = (this._buffer << 8) | this._data[this._offset + this._bytePos++];
            this._available += 8;
        }
        return (this._buffer >>> (this._available - n)) & ((1 << n) - 1);
    }
    readBits(n) {
        if (n === 0) return 0;
        // Keep the public reader's original signed 32-bit result.
        if (n > 24) return (this.readBits(n - 16) << 16) | this.readBits(16);
        const value = this.peekBits(n);
        this._available -= n;
        return value;
    }
    readByte() { return this.readBits(8); }
}
