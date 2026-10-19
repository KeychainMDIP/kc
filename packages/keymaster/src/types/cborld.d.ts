declare module "@digitalbazaar/cborld" {
    export interface RemoteDocument {
        readonly contextUrl: string | null;
        readonly document: object;
        readonly documentUrl: string | null;
    }

    export type DocumentLoader = (
        url: string
    ) => Promise<RemoteDocument | undefined>;

    export type DiagnosticFunction = (message: string) => unknown;

    export type TypeTable = Map<string, Map<string,number>>

    export type TypeTableLoader = ( registryId: number ) => Promise<TypeTable | undefined>

    /**
     * Encodes a given JSON-LD document into a CBOR-LD byte array.
     *
     * @param {object} options - The options to use when encoding to CBOR-LD.
     * @param {object} options.jsonldDocument - The JSON-LD Document to convert to
     *   CBOR-LD bytes.
     * @param {DocumentLoader} options.documentLoader -The document loader
     *   to use when resolving JSON-LD Context URLs.
     * @param {boolean} [options.compressionMode=1] - `1` to use compression mode
     *   version 1, `0` to use no compression.
     * @param {Map} [options.appContextMap] - A map of JSON-LD Context URLs and
     *   their encoded CBOR-LD values (must be values greater than 32767 (0x7FFF)).
     * @param {boolean} [options.compressionModeUndefinedTermAllowed] - Allow the
     *   JSON-LD document to contain terms that are not defined in the context. The
     *   original values of the undefined terms will be preserved during
     *   compression. Defaults to `false`, every key that does not have a defined
     *   term will raise an error.
     * @param {DiagnosticFunction} [options.diagnose] - A function that, if
     * provided, is called with diagnostic information.
     *
     * @returns {Promise<Uint8Array>} - The encoded CBOR-LD bytes.
     */
    export function encode(options?: {
        jsonldDocument: object;
        documentLoader: DocumentLoader;
        compressionMode?: boolean;
        appContextMap?: Map<string, number>;
        compressionModeUndefinedTermAllowed?: boolean;
        diagnose?: DiagnosticFunction;
        registryEntryId?: number;
        typeTableLoader?: TypeTableLoader
    }): Promise<Uint8Array>;

    /**
     * Decodes a CBOR-LD byte array into a JSON-LD document.
     *
     * @param {object} options - The options to use when decoding CBOR-LD.
     * @param {Uint8Array} options.cborldBytes - The encoded CBOR-LD bytes to
     *   decode.
     * @param {DocumentLoader} options.documentLoader -The document loader to use when
     *   resolving JSON-LD Context URLs.
     * @param {Map} [options.appContextMap] - A map of JSON-LD Context URLs and
     *   their associated CBOR-LD values. The values must be greater than
     *   32767 (0x7FFF)).
     * @param {boolean} [options.compressionModeUndefinedTermAllowed] - Allow the
     *   JSON-LD document to contain terms that are not defined in the context. The
     *   original values of terms that cannot be resolved from the context map will
     *   be preserved. Defaults to `false`, every key that does not have a defined
     *   term will raise an error.
     * @param {DiagnosticFunction} [options.diagnose] - A function that, if
     *   provided, is called with diagnostic information.
     *
     * @returns {Promise<object>} - The decoded JSON-LD Document.
     */
    export function decode(options: {
        cborldBytes: Uint8Array;
        documentLoader: DocumentLoader;
        appContextMap?: Map<string, number>;
        compressionModeUndefinedTermAllowed?: boolean;
        diagnose?: DiagnosticFunction;
    }): Promise<object>;
}