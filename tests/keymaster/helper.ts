import Keymaster from "@mdip/keymaster";

export const mockJson = {
    key: "value",
    list: [1, 2, 3],
    obj: { name: "some object" }
};

export const mockSchema = {    // eslint-disable-next-line
    "$schema": "http://json-schema.org/draft-07/schema#",
    "properties": {
        "email": {
            "format": "email",
            "type": "string"
        }
    },
    "required": [
        "email"
    ],
    "type": "object"
};

export class TestHelper {
    private keymaster: Keymaster;

    constructor(keymaster: Keymaster) {
        this.keymaster = keymaster;
    }

    async setupCredentials() {
        await this.keymaster.createId('Alice');
        await this.keymaster.createId('Bob');
        const carol = await this.keymaster.createId('Carol');
        await this.keymaster.createId('Victor');

        await this.keymaster.setCurrentId('Alice');

        const credential1 = await this.keymaster.createSchema(mockSchema);
        const credential2 = await this.keymaster.createSchema(mockSchema);

        const bc1 = await this.keymaster.bindCredential(credential1, carol);
        const bc2 = await this.keymaster.bindCredential(credential2, carol);

        const vc1 = await this.keymaster.issueCredential(bc1);
        const vc2 = await this.keymaster.issueCredential(bc2);

        await this.keymaster.setCurrentId('Bob');

        const credential3 = await this.keymaster.createSchema(mockSchema);
        const credential4 = await this.keymaster.createSchema(mockSchema);

        const bc3 = await this.keymaster.bindCredential(credential3, carol);
        const bc4 = await this.keymaster.bindCredential(credential4, carol);

        const vc3 = await this.keymaster.issueCredential(bc3);
        const vc4 = await this.keymaster.issueCredential(bc4);

        await this.keymaster.setCurrentId('Carol');

        await this.keymaster.acceptCredential(vc1);
        await this.keymaster.acceptCredential(vc2);
        await this.keymaster.acceptCredential(vc3);
        await this.keymaster.acceptCredential(vc4);

        return [vc1, vc2, vc3, vc4];
    }
}
