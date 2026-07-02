import type Keymaster from "@mdip/keymaster";
import { CHAT_SUBJECT } from "../constants";
import {
    MESSAGE_RECEIPT_PAYLOAD_TYPE,
    MessageReceiptType,
    stringifyChatPayload,
} from "./utils";

type SendMessageReceiptOptions = {
    keymaster: Keymaster;
    registry: string;
    messageId: string;
    senderDid: string;
    recipientDid: string;
    receiptType: MessageReceiptType;
    groupId?: string;
};

export async function sendMessageReceipt({
    keymaster,
    registry,
    messageId,
    senderDid,
    recipientDid,
    receiptType,
    groupId,
}: SendMessageReceiptOptions): Promise<string | null> {
    const payload = {
        type: MESSAGE_RECEIPT_PAYLOAD_TYPE,
        version: 1,
        receiptType,
        messageId,
        recipientDid,
        ...(groupId ? { groupId } : {}),
        at: new Date().toISOString(),
    };

    const dmail = {
        to: [senderDid],
        cc: [],
        subject: CHAT_SUBJECT,
        body: stringifyChatPayload(payload),
    };

    const did = await keymaster.createDmail(dmail, { registry });

    try {
        const notice = await keymaster.sendDmail(did);
        if (!notice) {
            await keymaster.removeDmail(did);
            return null;
        }

        return notice;
    } catch (error) {
        await keymaster.removeDmail(did).catch(() => {});
        throw error;
    }
}
