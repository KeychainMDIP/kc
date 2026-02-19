import {ChakraProvider, defaultSystem} from "@chakra-ui/react";
import {
    ColorModeProvider,
    type ColorModeProviderProps,
} from "./ColorModeProvider"

export function UIProvider(props: ColorModeProviderProps) {
    return (
        <ChakraProvider value={defaultSystem}>
            <ColorModeProvider {...props} />
        </ChakraProvider>
    )
}
