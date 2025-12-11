import { PropsWithChildren } from "react";
import { Box } from "@chakra-ui/react";

export interface SlideInRightProps {
    isOpen: boolean;
    zIndex?: number;
    bottomOffset?: string | number;
    bg?: string;
}

export default function SlideInRight({ isOpen, zIndex = 1200, bottomOffset = "46px", bg = "white", children }: PropsWithChildren<SlideInRightProps>) {
    return (
        <Box
            position="absolute"
            top={0}
            left={0}
            right={0}
            bottom={bottomOffset}
            zIndex={zIndex}
            bg={bg}
            display="flex"
            flexDirection="column"
            style={{
                transform: isOpen ? "translateX(0%)" : "translateX(100%)",
                transition: "transform 200ms ease",
            }}
            pointerEvents={isOpen ? "auto" : "none"}
        >
            {children}
        </Box>
    );
}
