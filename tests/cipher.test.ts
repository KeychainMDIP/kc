import CipherNode from '@mdip/cipher/node';
import { ProofOfWork } from '@mdip/cipher/types';
import { ExpectedExceptionError } from '@mdip/common/errors';

const cipher = new CipherNode();

const mockObject = {
    name: 'Bob',
    age: 42
};

describe('addProofOfWork', () => {
    it('should add valid PoW to an object', async () => {
        const difficulty = 8;
        const result = cipher.addProofOfWork(mockObject, difficulty) as { pow: ProofOfWork };

        expect(result).toHaveProperty('pow');
        expect(result.pow.difficulty).toBe(difficulty);

        const hash = cipher.hashJSON(result);
        expect(cipher.hasLeadingZeroBits(hash, difficulty)).toBe(true);
    });

    it('should add valid PoW with specified difficulty', async () => {
        for (let difficulty = 1; difficulty <= 12; difficulty++) {
            const result = cipher.addProofOfWork(mockObject, difficulty) as { pow: ProofOfWork };

            expect(result).toHaveProperty('pow');
            expect(result.pow.difficulty).toBe(difficulty);

            const hash = cipher.hashJSON(result);
            expect(cipher.hasLeadingZeroBits(hash, difficulty)).toBe(true);
        }
    });

    it('should throw exception on difficulty out of range', async () => {
        try {
            cipher.addProofOfWork(mockObject, -1);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid difficulty: must be an integer between 0 and 256.');
        }

        try {
            cipher.addProofOfWork(mockObject, 512);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid difficulty: must be an integer between 0 and 256.');
        }
    });
});

describe('checkProofOfWork', () => {
    it('should return true if PoW is valid', async () => {
        const difficulty = 8;
        const result = cipher.addProofOfWork(mockObject, difficulty) as { pow: ProofOfWork };
        const isValid = cipher.checkProofOfWork(result);

        expect(isValid).toBe(true);
    });

    it('should return false if PoW is not valid', async () => {
        const difficulty = 8;
        const result = cipher.addProofOfWork(mockObject, difficulty) as { pow: ProofOfWork };

        result.pow.difficulty = 20; // tamper with difficulty
        const isValid = cipher.checkProofOfWork(result);

        expect(isValid).toBe(false);
    });

    it('should return false if PoW missing', async () => {
        const result = cipher.checkProofOfWork(mockObject);
        expect(result).toBe(false);
    });

    it('should return false for invalid object', async () => {
        const result = cipher.checkProofOfWork({});
        expect(result).toBe(false);
    });
});

