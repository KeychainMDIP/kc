import {
    Toaster as ChakraToaster,
    Portal,
    Spinner,
    Stack,
    Toast,
    createToaster,
} from "@chakra-ui/react"

export const toaster = createToaster({
    placement: "bottom",
    pauseOnPageIdle: true,
    offsets: { bottom: "50px", left: "0px", right: "0px", top: "0px" },
})

export const Toaster = () => {
    return (
        <Portal>
            <ChakraToaster toaster={toaster}>
                {(toast) => (
                    <Toast.Root width={{ md: "sm" }}>
                        {toast.type === "loading" ? <Spinner size="sm" color="blue.solid" /> : <Toast.Indicator />}
                        <Stack gap="1" flex="1" maxWidth="100%">
                            {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
                            {toast.description && <Toast.Description>{toast.description}</Toast.Description>}
                        </Stack>
                        {toast.action && <Toast.ActionTrigger>{toast.action.label}</Toast.ActionTrigger>}
                        {toast.closable && <Toast.CloseTrigger />}
                    </Toast.Root>
                )}
            </ChakraToaster>
        </Portal>
    );
};
