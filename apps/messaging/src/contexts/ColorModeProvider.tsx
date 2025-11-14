"use client"

import { forwardRef } from "react"
import type { ReactNode } from "react"
import type { IconButtonProps } from "@chakra-ui/react"
import { ClientOnly, IconButton, Skeleton } from "@chakra-ui/react"
import { ThemeProvider, useTheme, type ThemeProviderProps } from "next-themes"
import { LuMoon, LuSun } from "react-icons/lu"

export interface ColorModeProviderProps
    extends Omit<ThemeProviderProps, "attribute" | "value" | "themes"> {
    children?: ReactNode
}

export function ColorModeProvider({ children, ...themeProps }: ColorModeProviderProps) {
    return (
        <ThemeProvider
            attribute="class"
            defaultTheme="light"
            value={{ light: "light", dark: "dark" }}
            themes={["light", "dark"]}
            enableSystem
            disableTransitionOnChange
            {...themeProps}
        >
            {children}
        </ThemeProvider>
    )
}

export type ColorMode = "light" | "dark"

export interface UseColorModeReturn {
    colorMode: ColorMode
    setColorMode: (colorMode: ColorMode) => void
    toggleColorMode: () => void
}

export function useColorMode(): UseColorModeReturn {
    const { resolvedTheme, setTheme } = useTheme()
    const colorMode = (resolvedTheme as ColorMode) || "light"
    const toggleColorMode = () => setTheme(colorMode === "dark" ? "light" : "dark")
    return {
        colorMode,
        setColorMode: setTheme as (mode: ColorMode) => void,
        toggleColorMode,
    }
}

export function ColorModeIcon() {
    const { colorMode } = useColorMode()
    return colorMode === "dark" ? <LuMoon /> : <LuSun />
}

interface ColorModeButtonProps extends Omit<IconButtonProps, "aria-label"> {}

export const ColorModeButton = forwardRef<HTMLButtonElement, ColorModeButtonProps>(
    function ColorModeButton(props, ref) {
        const { toggleColorMode } = useColorMode()
        return (
            <ClientOnly fallback={<Skeleton boxSize="9" />}>
                <IconButton onClick={toggleColorMode} variant="ghost" size="sm" ref={ref} {...props}>
                    <ColorModeIcon />
                </IconButton>
            </ClientOnly>
        )
    }
)
