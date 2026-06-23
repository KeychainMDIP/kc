import { generateCID, isValidCID } from '@mdip/ipfs/utils';

describe('generateCID', () => {
    it('should create a valid raw CID from string input', async () => {
        const data = 'mock text data';
        const cidFromString = await generateCID(data);
        const cidFromBuffer = await generateCID(Buffer.from(data));

        expect(isValidCID(cidFromString)).toBe(true);
        expect(cidFromString).toBe(cidFromBuffer);
    });
});
