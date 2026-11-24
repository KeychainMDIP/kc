import {BarcodeScanner} from "@capacitor-mlkit/barcode-scanning";
import { toSvg } from "jdenticon";
import {
    CHAT_PAYLOAD_TYPE_IMAGE,
    GROUP_MEMBERSHIP_ACTION_CREATED,
    GROUP_MEMBERSHIP_ACTION_MEMBER_ADDED,
    GROUP_MEMBERSHIP_ACTION_MEMBERS_SYNCED,
    GROUP_MEMBERSHIP_PAYLOAD_TYPE,
    GROUP_PROFILE_PAYLOAD_TYPE,
    MAX_KEYMASTER_NAME_LENGTH,
    MESSAGE_RECEIPT_PAYLOAD_TYPE,
    MESSAGE_RECEIPT_TYPE_DELIVERED,
    MESSAGE_RECEIPT_TYPE_READ,
} from "../constants";

export function avatarDataUrl(seed: string, size = 64) {
    const svg = toSvg(seed || "anonymous", size);
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

export function formatTime(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
        return "";
    }
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
        ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString();
}

export function extractDid(input: string): string | null {
    if (!input) {
        return null;
    }

    const didRegex = /did:[a-z0-9]+:[^\s&#?]+/i;

    const direct = input.match(didRegex);
    if (direct) {
        return direct[0];
    }

    try {
        const url = new URL(input);

        if (url.protocol === 'mdip:') {
            const host = (url.host || '').toLowerCase();

            if (host === 'auth') {
                const challenge = url.searchParams.get('challenge');
                if (challenge?.startsWith('did:')) {
                    return challenge;
                }
            }

            if (host === 'accept') {
                const credential = url.searchParams.get('credential');
                if (credential?.startsWith('did:')) {
                    return credential;
                }
            }
        }

        if (url.protocol === 'https:' || url.protocol === 'http:') {
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts.length >= 2 && parts[0].toLowerCase() === 'attest') {
                const cand = decodeURIComponent(parts[1]);
                if (cand.startsWith('did:')) {
                    return cand;
                }
            }

            const challenge = url.searchParams.get('challenge');
            if (challenge?.startsWith('did:')) {
                return challenge;
            }

            const credential = url.searchParams.get('credential');
            if (credential?.startsWith('did:')) {
                return credential;
            }
        }

        const fallback = input.match(didRegex)?.[0];
        if (fallback) {
            return fallback;
        }
    } catch {}

    return null;
}

async function ensureGoogleModuleReady(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()) {
            return true;
        }
        await new Promise(r => setTimeout(r, 400));
    }
    return false;
}

export async function scanQrCode() {
    try {
        const perm = await BarcodeScanner.requestPermissions();
        if (perm.camera !== 'granted') {
            return null;
        }

        const ready = await ensureGoogleModuleReady();
        if (!ready) {
            return null;
        }

        const { barcodes } = await BarcodeScanner.scan();

        let did: string | null = null;
        for (const b of barcodes) {
            const candidate = extractDid(b.rawValue);
            if (candidate) {
                did = candidate;
                break;
            }
        }

        if (!did) {
            return null;
        }

        return did;
    } catch {}
    return null;
}

export function truncateMiddle(str: string, max = 34) {
    if (str.length <= max) {
        return str;
    }
    const half = Math.floor((max - 3) / 2);
    return `${str.slice(0, half)}...${str.slice(-half)}`;
}

export function convertNamesToDIDs(names: string[], nameList: Record<string, string>) {
    let converted: string[] = [];
    for (let did of names) {
        converted.push(nameList[did] ?? did);
    }
    return converted;
}

export function arraysMatchMembers(arr1: string[], arr2: string[]) {
    if (arr1.length !== arr2.length) {
        return false;
    }
    const sorted1 = [...arr1].sort();
    const sorted2 = [...arr2].sort();
    return sorted1.every((val, idx) => val === sorted2[idx]);
}

export function makeUniqueContactAlias(
    profileName: string,
    did: string,
    nameList: Record<string, string>
): string {
    const fallback = did.slice(-20);
    const base = (profileName || fallback).trim() || fallback;

    const buildAlias = (suffix?: number) => {
        const suffixText = suffix ? ` #${suffix}` : "";
        const maxBaseLength = MAX_KEYMASTER_NAME_LENGTH - suffixText.length;
        const trimmedBase = base.slice(0, maxBaseLength).trim() || fallback.slice(0, maxBaseLength);
        return `${trimmedBase}${suffixText}`;
    };

    let alias = buildAlias();
    let suffix = 2;

    while (nameList[alias] && nameList[alias] !== did) {
        alias = buildAlias(suffix);
        suffix++;
    }

    return alias;
}

export type ChatPayload = {
    type?: string;
    version?: number;
    message?: string;
    groupId?: string;
    groupName?: string;
    groupAvatar?: string;
    groupAvatarUpdatedAt?: string;
    action?: string;
    memberDid?: string;
    members?: string[];
    receiptType?: string;
    messageId?: string;
    recipientDid?: string;
    at?: string;
    updatedAt?: string;
    [key: string]: unknown;
};

export type GroupMembershipAction =
    | typeof GROUP_MEMBERSHIP_ACTION_CREATED
    | typeof GROUP_MEMBERSHIP_ACTION_MEMBER_ADDED
    | typeof GROUP_MEMBERSHIP_ACTION_MEMBERS_SYNCED;
export type GroupMembershipPayload = ChatPayload & {
    type: typeof GROUP_MEMBERSHIP_PAYLOAD_TYPE;
    version: 1;
    groupId: string;
    groupName?: string;
    groupAvatar?: string;
    groupAvatarUpdatedAt?: string;
    action: GroupMembershipAction;
    memberDid?: string;
    members?: string[];
    updatedAt: string;
};
export type MessageReceiptType =
    | typeof MESSAGE_RECEIPT_TYPE_DELIVERED
    | typeof MESSAGE_RECEIPT_TYPE_READ;
export type MessageReceiptPayload = ChatPayload & {
    type: typeof MESSAGE_RECEIPT_PAYLOAD_TYPE;
    version: 1;
    receiptType: MessageReceiptType;
    messageId: string;
    recipientDid: string;
    at: string;
};

export function getChatMessageText(payload: ChatPayload | null | undefined): string {
    return typeof payload?.message === "string" ? payload.message.trim() : "";
}

export function isImageChatPayload(payload: ChatPayload | null | undefined): boolean {
    return payload?.type === CHAT_PAYLOAD_TYPE_IMAGE;
}

export function isGroupProfilePayload(payload: ChatPayload | null | undefined): boolean {
    return payload?.type === GROUP_PROFILE_PAYLOAD_TYPE;
}

export function isGroupMembershipPayload(payload: ChatPayload | null | undefined): boolean {
    return payload?.type === GROUP_MEMBERSHIP_PAYLOAD_TYPE;
}

export function getGroupMembershipPayload(payload: ChatPayload | null | undefined): GroupMembershipPayload | null {
    if (!isGroupMembershipPayload(payload)) {
        return null;
    }

    const action = payload?.action;
    const groupId = typeof payload?.groupId === "string" ? payload.groupId.trim() : "";
    const groupName = typeof payload?.groupName === "string" ? payload.groupName.trim() : "";
    const groupAvatar = typeof payload?.groupAvatar === "string" ? payload.groupAvatar.trim() : "";
    const groupAvatarUpdatedAt = typeof payload?.groupAvatarUpdatedAt === "string" ? payload.groupAvatarUpdatedAt.trim() : "";
    const memberDid = typeof payload?.memberDid === "string" ? payload.memberDid.trim() : "";
    const members = Array.isArray(payload?.members)
        ? payload.members.map(member => typeof member === "string" ? member.trim() : "").filter(Boolean)
        : [];
    const updatedAt = typeof payload?.updatedAt === "string" ? payload.updatedAt.trim() : "";

    const uniqueMembers = Array.from(new Set(members));

    if (
        payload?.version !== 1 ||
        (
            action !== GROUP_MEMBERSHIP_ACTION_CREATED &&
            action !== GROUP_MEMBERSHIP_ACTION_MEMBER_ADDED &&
            action !== GROUP_MEMBERSHIP_ACTION_MEMBERS_SYNCED
        ) ||
        !groupId ||
        !updatedAt
    ) {
        return null;
    }

    if (action === GROUP_MEMBERSHIP_ACTION_CREATED && uniqueMembers.length === 0) {
        return null;
    }

    if (action === GROUP_MEMBERSHIP_ACTION_MEMBER_ADDED && !memberDid) {
        return null;
    }

    return {
        type: GROUP_MEMBERSHIP_PAYLOAD_TYPE,
        version: 1,
        groupId,
        ...(groupName ? { groupName } : {}),
        ...(groupAvatar ? { groupAvatar } : {}),
        ...(groupAvatarUpdatedAt ? { groupAvatarUpdatedAt } : {}),
        action,
        ...(memberDid ? { memberDid } : {}),
        ...(action === GROUP_MEMBERSHIP_ACTION_CREATED ? { members: uniqueMembers } : {}),
        updatedAt,
    };
}

export function isMessageReceiptPayload(payload: ChatPayload | null | undefined): boolean {
    return payload?.type === MESSAGE_RECEIPT_PAYLOAD_TYPE;
}

export function getMessageReceiptPayload(payload: ChatPayload | null | undefined): MessageReceiptPayload | null {
    if (!isMessageReceiptPayload(payload)) {
        return null;
    }

    const receiptType = payload?.receiptType;
    const messageId = typeof payload?.messageId === "string" ? payload.messageId.trim() : "";
    const recipientDid = typeof payload?.recipientDid === "string" ? payload.recipientDid.trim() : "";
    const at = typeof payload?.at === "string" ? payload.at.trim() : "";

    if (
        payload?.version !== 1 ||
        (receiptType !== MESSAGE_RECEIPT_TYPE_DELIVERED && receiptType !== MESSAGE_RECEIPT_TYPE_READ) ||
        !messageId ||
        !recipientDid ||
        !at
    ) {
        return null;
    }

    return {
        ...payload,
        type: MESSAGE_RECEIPT_PAYLOAD_TYPE,
        version: 1,
        receiptType,
        messageId,
        recipientDid,
        at,
    };
}

export function getMessageReceiptKey(
    receiptType: MessageReceiptType,
    messageId: string,
    recipientDid: string
): string {
    return `${receiptType}:${messageId}:${recipientDid}`;
}

export function getGroupAvatarDid(payload: ChatPayload | null | undefined): string {
    return typeof payload?.groupAvatar === "string" ? payload.groupAvatar.trim() : "";
}

export function canUpdateGroupProfile(senderDid: string | undefined, group: { members: string[] } | undefined): boolean {
    if (!senderDid || !group) {
        return false;
    }

    return group.members.includes(senderDid);
}

export function hasRenderableChatContent(payload: ChatPayload | null | undefined): boolean {
    return getChatMessageText(payload).length > 0 || isImageChatPayload(payload);
}

export function parseChatPayload(body: string): ChatPayload | null {
    if (typeof body !== "string") {
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
    }

    const payload = parsed as Record<string, unknown>;

    if ("type" in payload && typeof payload.type !== "string") {
        return null;
    }
    if ("version" in payload && typeof payload.version !== "number") {
        return null;
    }
    if ("message" in payload && typeof payload.message !== "string") {
        return null;
    }
    if ("groupId" in payload && typeof payload.groupId !== "string") {
        return null;
    }
    if ("groupName" in payload && typeof payload.groupName !== "string") {
        return null;
    }
    if ("groupAvatar" in payload && typeof payload.groupAvatar !== "string") {
        return null;
    }
    if ("groupAvatarUpdatedAt" in payload && typeof payload.groupAvatarUpdatedAt !== "string") {
        return null;
    }
    if ("action" in payload && typeof payload.action !== "string") {
        return null;
    }
    if ("memberDid" in payload && typeof payload.memberDid !== "string") {
        return null;
    }
    if ("members" in payload && (
        !Array.isArray(payload.members) ||
        payload.members.some(member => typeof member !== "string")
    )) {
        return null;
    }
    if ("receiptType" in payload && typeof payload.receiptType !== "string") {
        return null;
    }
    if ("messageId" in payload && typeof payload.messageId !== "string") {
        return null;
    }
    if ("recipientDid" in payload && typeof payload.recipientDid !== "string") {
        return null;
    }
    if ("at" in payload && typeof payload.at !== "string") {
        return null;
    }
    if ("updatedAt" in payload && typeof payload.updatedAt !== "string") {
        return null;
    }

    return payload as ChatPayload;
}

export function stringifyChatPayload(payload: ChatPayload): string {
    return JSON.stringify(payload);
}
