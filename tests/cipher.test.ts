import CipherNode from '@mdip/cipher/node';
import { ProofOfWork } from '@mdip/cipher/types';

const cipher = new CipherNode();

const mockObject = {
    name: 'Bob',
    age: 42
};

describe('addPoW', () => {
    it('should add valid PoW to an object', async () => {
        const difficulty = 8;
        const result = cipher.addPoW(mockObject, difficulty) as { pow: ProofOfWork };

        expect(result).toHaveProperty('pow');
        expect(result.pow.difficulty).toBe(difficulty);

        const hash = cipher.hashJSON(result);
        expect(cipher.hasLeadingZeroBits(hash, difficulty)).toBe(true);
    });

    it('should add valid PoW with specified difficulty', async () => {
        for (let difficulty = 1; difficulty <= 12; difficulty++) {
            const result = cipher.addPoW(mockObject, difficulty) as { pow: ProofOfWork };

            expect(result).toHaveProperty('pow');
            expect(result.pow.difficulty).toBe(difficulty);

            const hash = cipher.hashJSON(result);
            expect(cipher.hasLeadingZeroBits(hash, difficulty)).toBe(true);
        }
    });
});

describe('checkPoW', () => {
    it('should return true if PoW is valid', async () => {
        const difficulty = 8;
        const result = cipher.addPoW(mockObject, difficulty) as { pow: ProofOfWork };
        const isValid = cipher.checkPoW(result);

        expect(isValid).toBe(true);
    });

    it('should return false if PoW is not valid', async () => {
        const difficulty = 8;
        const result = cipher.addPoW(mockObject, difficulty) as { pow: ProofOfWork };

        result.pow.difficulty = 20; // tamper with difficulty
        const isValid = cipher.checkPoW(result);

        expect(isValid).toBe(false);
    });

    it('should return false if PoW missing', async () => {
        const result = cipher.checkPoW(mockObject);
        expect(result).toBe(false);
    });

    it('should return false for invalid object', async () => {
        const result = cipher.checkPoW({});
        expect(result).toBe(false);
    });
});

