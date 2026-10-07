declare module "@digitalbazaar/credentials-context" {
    export interface ContextMetadata {
        id: string,
        type: 'ContextMetadata',
        shortName: string,
        url: URL,
        context: object
    }

    export const contexts : Map<string,object>
    // map of context id to context metadata
    export const metadata = Map<string,ContextMetadata>
    // map of short names to context metadata
    export const named = new Map<string,ContextMetadata>
}