/* MPL-2.0. Coefficient unpacking equivalent to mvs.js, mvs-rice.js and
 * mvs-huffman.js. Bit positions are explicit; malformed input is bounded. */
#define INPUT_CAPACITY (8 * 1024 * 1024)
static unsigned char entropy_input[INPUT_CAPACITY];
static short entropy_state[192];
static signed char entropy_descriptor[64], entropy_entry[99];
static unsigned int entropy_addresses[4];
static int ep, elimit, eerror;
unsigned int entropy_buffers(void) {
    entropy_addresses[0] = (unsigned int)entropy_input;
    entropy_addresses[1] = (unsigned int)entropy_state;
    entropy_addresses[2] = (unsigned int)entropy_descriptor;
    entropy_addresses[3] = (unsigned int)entropy_entry;
    return (unsigned int)entropy_addresses;
}
static int take(int n) {
    if (n < 0 || n > 24 || ep > elimit - n) { eerror = 1; return 0; }
    if (!n) return 0;
    int byte = ep >> 3, shift = ep & 7;
    unsigned int v = entropy_input[byte];
    int have = 8 - shift;
    while (have < n) { v = (v << 8) | entropy_input[++byte]; have += 8; }
    ep += n;
    return (v >> (have - n)) & ((1u << n) - 1);
}
static int ones(void) {
    int n = 0;
    while (!eerror && take(1)) n++;
    return n;
}
static int dc_rice(void) {
    int n = ones(), magnitude;
    if (!n) { if (!take(1)) return 0; magnitude = 1; }
    else if (n == 1) magnitude = 2 + take(1);
    else if (n == 2) magnitude = 4 + take(2);
    else magnitude = ((n << 3) | take(3)) - 16;
    return take(1) ? -magnitude : magnitude;
}
static int quant_step(int pos, int threshold) {
    if (pos <= 5) return threshold > 14 ? 2 : pos < threshold ? 8 : 16;
    if (threshold > 14) return pos < threshold ? 2 : 8;
    return pos < threshold ? 8 : 16;
}
static int ac_rice(int near) {
    int n = ones(), magnitude;
    if (near) magnitude = n <= 3 ? 2 + n * 4 + take(2) : 18 + (n - 4) * 8 + take(3);
    else magnitude = n == 0 ? 2 + take(1) : n == 1 ? 4 + take(2) : ((n << 3) | take(3)) - 8;
    return take(1) ? -magnitude : magnitude;
}
static void begin_entropy(int position, int length) { ep = position; elimit = length * 8; eerror = 0; }
int entropy_position(void) { return eerror ? -1 : ep; }
// Returns the selected threshold, or -1 for a repeated tile.
int entropy_full(int position, int length, int t1, int t2, int previous) {
    begin_entropy(position, length);
    for (int i = 0; i < 192; i++) coefficients[i] = 0;
    if (take(1)) {
        if (previous) {
            for (int i = 0; i < 64; i++) coefficients[i] = entropy_state[i];
            coefficients[64] = entropy_state[64]; coefficients[128] = entropy_state[128];
        }
        return -1;
    }
    int mode = take(1), threshold = take(1) ? t2 : t1;
    if (!mode) {
        int cb = entropy_state[64], cr = entropy_state[128];
        coefficients[64] = (((cb + (cb < 0)) >> 1) - dc_rice()) * 2;
        coefficients[128] = (((cr + (cr < 0)) >> 1) - dc_rice()) * 2;
    } else { coefficients[64] = entropy_state[64]; coefficients[128] = entropy_state[128]; }
    coefficients[0] = entropy_state[0] - dc_rice();
    int pos = 1;
    while (pos < 64 && !eerror) {
        if (take(1)) { coefficients[pos] = ac_rice(pos <= 5) * quant_step(pos, threshold); pos++; }
        else {
            int mode = take(2);
            if (mode == 0) coefficients[pos++] = 0;
            else if (mode == 1) {
                if (!take(1)) break;
                int ext = take(2), run = ext + 3;
                if (ext == 3) {
                    run = 6;
                    while (!eerror) { int chunk = take(3); run += chunk; if (chunk < 7 || run + pos >= 64) break; }
                }
                pos += run;
            } else { coefficients[pos] = (mode == 2 ? 1 : -1) * quant_step(pos, threshold); pos++; }
        }
    }
    return threshold;
}
static int huffman_symbol(void) {
    int code = 0, base = 0, offset = 0;
    for (int length = 1; length <= 16 && !eerror; length++) {
        code = (code << 1) | take(1);
        int count = ac_luminance_bits[length - 1];
        if (code >= base && code < base + count) return ac_luminance_values[offset + code - base];
        offset += count; base = (base + count) << 1;
    }
    eerror = 1; return 0;
}
static void huffman_ac(int offset, int limit) {
    int k = 0;
    while (k < limit && !eerror) {
        int symbol = huffman_symbol(), run = symbol >> 4, bits = symbol & 15;
        if (!bits) { if (run != 15) break; k += 16; continue; }
        k += run;
        int raw = take(bits), value = raw < (1 << (bits - 1)) ? raw - (1 << bits) + 1 : raw;
        coefficients[offset + (k + 1 < 63 ? k + 1 : 63)] = value;
        k++;
    }
}
static int chroma_delta(int baseline) {
    int bit = take(1);
    if (baseline) return (signed char)(baseline >= 0 ? baseline + bit : baseline - bit);
    return bit ? (take(1) ? -1 : 1) : 0;
}
void entropy_partial(int position, int length, int threshold, int cr, int cb, int cr_limit, int cb_limit) {
    begin_entropy(position, length);
    for (int i = 0; i < 192; i++) coefficients[i] = 0;
    for (int i = 0; i < 99; i++) entropy_entry[i] = 0;
    coefficients[0] = entropy_entry[0] = entropy_descriptor[0];
    int count = take(6), end = count + 1, desc = 1, entry = 1;
    int first_end = end < threshold ? end : threshold;
    for (int pos = 1; pos < first_end && !eerror; pos++) {
        int prev = desc < 64 ? entropy_descriptor[desc] : 0, value = 0;
        desc++;
        if (threshold < 15) {
            if (!prev) value = (signed char)dc_rice();
            else { int delta = take(3); value = (signed char)(prev >= 0 ? prev + delta : prev - delta); }
        } else {
            if (!prev) { if (take(1)) value = take(1) ? -1 : 1; }
            else { int delta = take(1); value = (signed char)(prev >= 0 ? prev + delta : prev - delta); }
        }
        coefficients[pos] = value; entropy_entry[entry++] = value;
    }
    if (count >= threshold) {
        for (int pos = threshold; pos < end && !eerror; pos++) {
            int prev = desc < 64 ? entropy_descriptor[desc] : 0, value;
            desc++;
            if (!prev) value = (signed char)dc_rice();
            else { int delta = take(threshold < 15 ? 4 : 3); value = (signed char)(prev >= 0 ? prev + delta : prev - delta); }
            coefficients[pos] = value; entropy_entry[entry++] = value;
        }
    }
    coefficients[128] = chroma_delta(cr); huffman_ac(128, cr_limit);
    for (int i = 0; i < 15; i++) entropy_entry[64 + i] = coefficients[128 + i];
    coefficients[64] = chroma_delta(cb); huffman_ac(64, cb_limit);
    for (int i = 0; i < 20; i++) entropy_entry[79 + i] = coefficients[64 + i];
}
