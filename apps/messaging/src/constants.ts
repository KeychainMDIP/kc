import {Capacitor} from "@capacitor/core";

const platform = Capacitor.getPlatform();
const isAndroid = platform === 'android';
// Android emulators route host loopback through this reserved address.
// eslint-disable-next-line sonarjs/no-hardcoded-ip
const HOST = isAndroid ? '10.0.2.2' : 'localhost';

const ENV_GATEKEEPER = (import.meta.env.VITE_GATEKEEPER_URL as string) || '';
const ENV_SEARCH = (import.meta.env.VITE_SEARCH_URL as string) || '';

export const DEFAULT_GATEKEEPER_URL = ENV_GATEKEEPER || `http://${HOST}:4224`;
export const DEFAULT_SEARCH_SERVER_URL = ENV_SEARCH || `http://${HOST}:4002`;
export const GATEKEEPER_KEY = 'mdip-messaging-gatekeeper-url';
export const SEARCH_SERVER_KEY = 'mdip-messaging-search-server-url';

export const CHAT_SUBJECT = "mdip-messaging";
export const WALLET_NAME = "mdip-messaging-wallet";

export const MESSAGING_PROFILE = "mdip-messaging-test";

export const REFRESH_INTERVAL = 5_000;
export const SERVICE_READY_TIMEOUT_MS = 3_000;
export const MAX_KEYMASTER_NAME_LENGTH = 32;

export const DMAIL_TAG_UNREAD = "unread";
export const DMAIL_TAG_SENT = "sent";
export const DMAIL_TAG_FAILED = "failed";
export const DMAIL_TAG_RETRYING = "retrying";
export const DMAIL_TAG_DELETED = "deleted";
export const DMAIL_TAG_ARCHIVED = "archived";

export const CHAT_PAYLOAD_TYPE_IMAGE = "image";
export const IMAGE_FILE_ACCEPT = "image/*";
export const GROUP_PROFILE_PAYLOAD_TYPE = "group-profile";
export const GROUP_MEMBERSHIP_PAYLOAD_TYPE = "group-membership";
export const MESSAGE_RECEIPT_PAYLOAD_TYPE = "message-receipt";

export const GROUP_MEMBERSHIP_ACTION_CREATED = "created";
export const GROUP_MEMBERSHIP_ACTION_MEMBER_ADDED = "member-added";
export const GROUP_MEMBERSHIP_ACTION_MEMBERS_SYNCED = "members-synced";

export const MESSAGE_RECEIPT_TYPE_DELIVERED = "delivered";
export const MESSAGE_RECEIPT_TYPE_READ = "read";

export const LOCAL_GROUP_ID_PREFIX = "mdip-group";
export const GROUP_NOT_FOUND_MESSAGE = "Group not found";
export const HIDDEN_GROUPS_STORAGE_PREFIX = "mdip-messaging-hidden-groups";
