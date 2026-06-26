import {createContext , useContext , useRef, useState, useCallback} from "react";
import type {ReactNode} from "react";
import {useTerminalDimensions} from "@opentui/react";
import type {ToastOptions, ToastVariant} from "./types";
import {DEFAULT_DURATION} from "./types";

export type ToastContextValue = {
    show :(options : ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);


export function useToast() : ToastContextValue {
    const value  = useContext(ToastContext);
    if(!value){
        throw new Error("useToast must be used within a toast provider");
    }

    return value;
}

type ToastProviderProps = {
    children  : ReactNode;
};

export function ToastProvider({children} : ToastProviderProps){
    const [currentToast, setCurrentToast] = useState<ToastOptions | null>(null);
    const timeoutHandleRef = useRef<NodeJS.Timeout | null>(null);

    const clearCurrentTimeout = useCallback(()=>{
        if(timeoutHandleRef.current){
            clearTimeout(timeoutHandleRef.current);
            timeoutHandleRef.current = null;
        }

    },[]);


    const show  = useCallback((options : ToastOptions)=>{
        const duration  = options.duration ?? DEFAULT_DURATION;
        clearCurrentTimeout();

        setCurrentToast({
            variant : options.variant ?? "info",
            ...options,
            duration,
        });

        timeoutHandleRef.current = setTimeout(()=>{
            setCurrentToast(null);
        },duration).unref();

    },[clearCurrentTimeout]);

    const value : ToastContextValue = {
        show,
    }


    return (
        <ToastContext.Provider value ={value}>
            {children}
            <Toast currentToast = {currentToast}/>

        </ToastContext.Provider>
    )

};


type ToastProps  = {
    currentToast : ToastOptions | null;

};

function Toast({currentToast} : ToastProps){
    const {width} = useTerminalDimensions();

    if(!currentToast){
        return null;
    }

    const variantColors : Record <ToastVariant, string> = {
        success : "#82E0AA",
        error : "#E74C5E",
        info  :"#89B4FA"
    };

    const variantIcons : Record <ToastVariant, string> = {
        success : "✓",
        error : "✗",
        info  :"ℹ"
    };

    const variant = currentToast.variant ?? "info";
    const borderColor = variantColors[variant];
    const icon = variantIcons[variant];

    return (
        <box 
        position ="absolute"
        justifyContent = "center"
        alignItems="center"
        top = {2}
        right = {2}
        width = {Math.max(30, Math.min(70, width - 20))}
        paddingLeft = {2}
        paddingRight = {2}
        paddingTop = {1}
        paddingBottom = {1}
        backgroundColor = "#1A1A24"
        borderColor = {borderColor}
        border ={["left", "right", "top", "bottom"]}
        >
            <box flexDirection = "column" gap = {1} width = "100%" >
                <box flexDirection="row" gap={1}>
                    <text fg={borderColor}>{icon}</text>
                    <text fg ="white" wrapMode = "word" width ="100%" >{currentToast.message}</text>
                </box>
            </box>
        </box>
    )
}
