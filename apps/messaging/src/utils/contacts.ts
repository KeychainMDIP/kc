import type Keymaster from "@mdip/keymaster";
import { MESSAGING_PROFILE } from "../constants";
import { makeUniqueContactAlias } from "./utils";

export type AddMessagingContactResult = {
    aliasName: string;
    did: string;
    profileName: string;
};

export async function addMessagingContact(
    keymaster: Keymaster,
    did: string,
    nameList: Record<string, string>
): Promise<AddMessagingContactResult> {
    const aliasDID = did.trim();
    if (!aliasDID) {
        throw new Error("Invalid DID");
    }

    const existing = Object.entries(nameList).find(([, value]) => value === aliasDID);
    if (existing) {
        throw new Error(`User already added as ${existing[0]}`);
    }

    let doc: Awaited<ReturnType<Keymaster["resolveDID"]>>;
    try {
        doc = await keymaster.resolveDID(aliasDID);
    } catch {
        throw new Error("DID not found");
    }

    if (doc.mdip?.type !== "agent") {
        throw new Error("DID is not an agent");
    }

    const data: Record<string, any> = doc.didDocumentData ?? {};
    const existingProfile: Record<string, any> = data[MESSAGING_PROFILE] ?? {};

    if (!existingProfile.name || typeof existingProfile.name !== "string" || !existingProfile.name.trim()) {
        throw new Error("This is not a valid messaging user");
    }

    const profileName = existingProfile.name.trim();
    const aliasName = makeUniqueContactAlias(profileName, aliasDID, nameList);
    await keymaster.addName(aliasName, aliasDID);

    return {
        aliasName,
        did: aliasDID,
        profileName,
    };
}
