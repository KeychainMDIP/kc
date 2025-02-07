import fs from 'fs';

export default class JsonFile {
    constructor(name, dataFolder = 'data') {
        this.dataFolder = dataFolder;
        this.fileName = `${dataFolder}/${name}.json`;
    }

    async saveDb(data) {
        if (!fs.existsSync(this.dataFolder)) {
            fs.mkdirSync(this.dataFolder, { recursive: true });
        }

        fs.writeFileSync(this.fileName, JSON.stringify(data, null, 4));
        return true;
    }

    async loadDb() {
        if (!fs.existsSync(this.fileName)) {
            return null;
        }

        const data = fs.readFileSync(this.fileName);
        return JSON.parse(data);
    }
}
