import {
    CSSProperties,
    ReactNode,
} from "react";
import JsonView from "@uiw/react-json-view";
import type { MdipDocument } from "@mdip/gatekeeper/types";

export type JsonDocumentValue = Record<string, unknown> | unknown[];

type JsonDocumentViewProps = {
    value: JsonDocumentValue;
    onResolveDID?: (did: string) => void | Promise<void>;
};

function JsonDocumentView({ value, onResolveDID }: JsonDocumentViewProps) {
    return (
        <JsonView
            value={value}
            shortenTextAfterLength={0}
        >
            <JsonView.String
                render={(
                    viewRenderProps: {
                        children?: ReactNode;
                        style?: CSSProperties;
                        [key: string]: any;
                    },
                    nodeInfo: {
                        value?: unknown;
                        type: "type" | "value";
                        keyName?: string | number;
                    }
                ) => {
                    const { children, style, ...rest } = viewRenderProps;
                    const { value: nodeValue, type, keyName } = nodeInfo;

                    if (typeof nodeValue === "string" && nodeValue.startsWith("did:") && type === "value") {
                        return (
                            <span
                                {...rest}
                                style={{ ...style, color: "blue", textDecoration: "underline", cursor: "pointer" }}
                                onClick={() => onResolveDID?.(nodeValue)}
                            >
                                {children}
                            </span>
                        );
                    }

                    if (type === "value" &&
                        (value as MdipDocument)?.didDocumentMetadata?.timestamp?.chain === "TBTC"
                    ) {
                        const currentKeyString = String(keyName);
                        let url = "";

                        if (currentKeyString === "blockid") {
                            url = `https://mempool.space/testnet4/block/${nodeValue}`;
                        } else if (currentKeyString === "txid") {
                            url = `https://mempool.space/testnet4/tx/${nodeValue}`;
                        }

                        if (url) {
                            return (
                                <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ ...style, color: "blue", textDecoration: "underline", cursor: "pointer" }}
                                >
                                    {children}
                                </a>
                            );
                        }
                    }

                    return undefined;
                }}
            />
        </JsonView>
    );
}

export function toJsonDocumentValue(value: unknown): JsonDocumentValue {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value === "object" && value !== null) {
        return value as Record<string, unknown>;
    }

    return { value };
}

export default JsonDocumentView;
