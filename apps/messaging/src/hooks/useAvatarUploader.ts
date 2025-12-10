import React, { useRef, useState, useMemo } from "react";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { MESSAGING_PROFILE } from "../constants";
import { avatarDataUrl } from "../utils/utils";

export function useAvatarUploader() {
    const { keymaster } = useWalletContext();
    const { setError, setSuccess } = useSnackbar();
    const { currentDID, currentId, refreshNames, profileList } = useVariablesContext();

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

            const doc = await keymaster.resolveDID(currentDID);

            const data: Record<string, any> = doc.didDocumentData ?? {};
            const profileKey = MESSAGING_PROFILE;

            const existingProfile: Record<string, any> = data[profileKey] ?? {};
            data[profileKey] = {
                ...existingProfile,
                avatar: assetDid,
            };

            doc.didDocumentData = data;
            await keymaster.updateDID(doc);

            setSuccess("Profile picture updated!");
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
        const profile = profileList[currentId];
        const custom = profile?.avatar;
        return custom ? custom : avatarDataUrl(currentDID);
    }, [profileList, currentId, currentDID]);

    return {
        isUploading,
        fileInputRef,
        handleAvatarClick,
        handleFileChange,
        userAvatar,
    };
}

export default useAvatarUploader;
