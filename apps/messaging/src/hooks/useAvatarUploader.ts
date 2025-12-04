import React, { useRef, useState, useMemo } from "react";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { PROFILE_SCHEMA, PROFILE_SCHEMA_ID, PROFILE_VC_ALIAS } from "../constants";
import { avatarDataUrl } from "../utils/utils";

export function useAvatarUploader() {
    const { keymaster } = useWalletContext();
    const { setError, setSuccess, setWarning } = useSnackbar();
    const { nameList, currentDID, currentId, refreshNames, avatarList } = useVariablesContext();

    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleAvatarClick = () => {
        if (!isUploading && fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !keymaster) {
            return;
        }

        try {
            setIsUploading(true);

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const assetDid = await keymaster.createImage(buffer);

            const existingVcDid = nameList[PROFILE_VC_ALIAS];

            if (existingVcDid) {
                try {
                    const vc = await keymaster.getCredential(existingVcDid);

                    if (vc && vc.credential) {
                        vc.credential[PROFILE_SCHEMA_ID] = assetDid;

                        await keymaster.updateCredential(existingVcDid, vc);
                        await keymaster.publishCredential(existingVcDid, { reveal: true });

                        setSuccess("Profile picture updated!");
                        await refreshNames();
                        return;
                    }
                } catch {
                    setWarning("Failed to update, creating new");
                }
            }

            let schemaDid;
            if (nameList[PROFILE_SCHEMA_ID] === undefined) {
                schemaDid = await keymaster.createSchema(PROFILE_SCHEMA);
                await keymaster.addName(PROFILE_SCHEMA_ID, schemaDid);
            } else {
                schemaDid = nameList[PROFILE_SCHEMA_ID];
            }

            const boundCredential = await keymaster.bindCredential(
                schemaDid,
                currentDID,
                { credential: { [PROFILE_SCHEMA_ID]: assetDid } }
            );

            const vcDid = await keymaster.issueCredential(boundCredential);
            await keymaster.acceptCredential(vcDid);
            await keymaster.publishCredential(vcDid, { reveal: true });
            await keymaster.addName(PROFILE_VC_ALIAS, vcDid);

            setSuccess("Profile picture set!");
            await refreshNames();
        } catch (e: any) {
            setError(e);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };

    const userAvatar = useMemo(() => {
        const custom = avatarList[currentId];
        return custom ? custom : avatarDataUrl(currentDID);
    }, [avatarList, currentId, currentDID]);

    return {
        isUploading,
        fileInputRef,
        handleAvatarClick,
        handleFileChange,
        userAvatar,
    };
}

export default useAvatarUploader;
