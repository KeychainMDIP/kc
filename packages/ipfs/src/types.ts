export interface IPFSClient {
    addText(text: string): Promise<string>;
    getText(cid: string): Promise<string>;
    addData(data: Buffer): Promise<string>;
    getData(cid: string): Promise<Buffer>;
    addJSON(json: any): Promise<string>;
    getJSON(cid: string): Promise<any>;
    generateCID(json: any): Promise<string>;
}
