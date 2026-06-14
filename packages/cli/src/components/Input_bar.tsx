import { CommandMenu } from "./command-menu";
import { StatusBar } from "./Status_bar"
import { KeyBinding, TextareaRenderable } from "@opentui/core";
import { useRef, useCallback , useEffect } from "react";
import type { TextRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { Command } from "./command-menu/types";
import { useCommandMenu } from "./command-menu/use-command-menu";
import { useToast } from "../providers/toast";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useDialog } from "../providers/dialog";


type Props = {
    onSubmit : (text : String) => void,
    disabled?: boolean;
};


export const TEXTAREA_KEY_BINDINGS : KeyBinding[] = [
    {name :"return" , action : "submit"},
    {name :"enter" , action : "submit"},
    {name :"return" , shift:true, action : "newline"},
    {name :"enter" , shift:true, action : "newline"},

];


export function InputBar({onSubmit , disabled = false} : Props ){
    const textareaRef = useRef<TextareaRenderable>(null);
    const onSubmitRef = useRef<() => void>(()=>{});
    const renderer = useRenderer();
    const toast  = useToast();
    const dialog = useDialog();
    const {isTopLayer , setResponder} = useKeyboardLayer();

    const {
        showCommandMenu,
        commandQuery,
        selectedIndex,
        scrollRef,
        handleContentChange,
        resolveCommand,
        setSelectedIndex,
    } = useCommandMenu();

   
    const handleTextareaContentChange = useCallback(()=>{
        const textarea = textareaRef.current;
        if(!textarea) return;

        handleContentChange(textarea.plainText);


    }, [])


    const handleCommand = useCallback((command : Command | undefined)=>{
        const textarea = textareaRef.current;
        if(!textarea || !command) return ;

        textarea.setText("");

        if(command.action){
            command.action({
                exit : ()=>renderer.destroy(),
                toast,
                dialog,
            })
        }else{
            textarea.insertText(command.value + " ");

        }

    }, [renderer, toast]);

     const handleCommandExecute = useCallback((index : number)=>{
        const command = resolveCommand(index);
        handleCommand(command);

    }, [resolveCommand, handleCommand])




    const handleSubmit = useCallback(()=>{
        if(disabled) return ;
        const textarea  = textareaRef.current;
        if(!textarea) return ;

        const text = textarea.plainText.trim();
        if(text.length ===0 ) return ;

        onSubmit(text);
        textarea.setText("");
        
    }, [disabled , onSubmit]);


    useEffect(()=>{
        const textarea = textareaRef.current;
        if(!textarea) return ;

        textarea.onSubmit = () =>{
            onSubmitRef.current();
        };

    },[]);

    onSubmitRef.current = () =>{
        if(disabled) return ;

        if(showCommandMenu) {
            const command = resolveCommand(selectedIndex);
            handleCommand(command);
            return;
        }

        handleSubmit();
    }



    useEffect(()=>{

        setResponder("base", ()=>{
            if(disabled) return false;

            const textarea = textareaRef.current;
            if(textarea && textarea.plainText.length > 0){
                textarea.setText("");
                return true;
            }
            return false;
        })

        return ()=> setResponder("base" , null);

    },[disabled , setResponder]);


    return (
        <box width = "100%" alignItems = "center">

            <box border = {["left"]} borderColor = "cyan">
                <box position= "relative" 
                     justifyContent = "center"
                     paddingX = {2}
                     paddingY = {1}
                     backgroundColor = {"#22262E"}
                     width ="100%"
                     gap = {1}>
                {showCommandMenu && (
                    <box position ="absolute" bottom = "100%" left = {0} width="100%" backgroundColor = {"#22262E"} zIndex = {10}>
                        <CommandMenu query= {commandQuery}
                                     selectedIndex = {selectedIndex}
                                     scrollRef = {scrollRef}
                                     onSelect = {setSelectedIndex}
                                     onExecute = {handleCommandExecute}    />
                    </box>
                )}
                <textarea  width ="100%" 
                ref ={textareaRef}
                focused = {!disabled && (isTopLayer("base") || isTopLayer("command"))}
                 placeholder={`Ask Anything ...`}  
                 keyBindings={TEXTAREA_KEY_BINDINGS}
                 onContentChange={handleTextareaContentChange}/> 
                <StatusBar/>

                </box>               
            </box>

        </box>

    )
};