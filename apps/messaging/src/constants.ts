import {Capacitor} from "@capacitor/core";

const platform = Capacitor.getPlatform();
const isAndroid = platform === 'android';
const HOST = isAndroid ? '10.0.2.2' : 'localhost';

const ENV_GATEKEEPER = (import.meta.env.VITE_GATEKEEPER_URL as string) || '';
const ENV_SEARCH = (import.meta.env.VITE_SEARCH_URL as string) || '';

export const DEFAULT_GATEKEEPER_URL = ENV_GATEKEEPER || `http://${HOST}:4224`;
export const DEFAULT_SEARCH_SERVER_URL = ENV_SEARCH || `http://${HOST}:4002`;
export const GATEKEEPER_KEY = 'mdip-messaging-gatekeeper-url';
export const SEARCH_SERVER_KEY = 'mdip-messaging-search-server-url';

export const CHAT_SUBJECT = "mdip-messaging";
export const WALLET_NAME = "mdip-messaging-wallet";

export const PROFILE_SCHEMA_ID = "mdip-messaging-profile";
export const PROFILE_VC_ALIAS = "mdip-messaging-profile-vc";
export const PROFILE_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "properties": {
        [PROFILE_SCHEMA_ID]: {
            "type": "string",
            "description": "IPFS Link to profile picture"
        }
    },
    "required": [PROFILE_SCHEMA_ID]
};
