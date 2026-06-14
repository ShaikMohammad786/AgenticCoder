import { DialogContextValue } from "../../providers/dialog";
import { ToastContextValue } from "../../providers/toast";

export type CommandContext = {
    exit: ()=> void;
    toast: ToastContextValue;
    dialog: DialogContextValue
};


export type Command = {
    name :string, 
    description : string,
    value : string,
    action?:(ctx: CommandContext) =>void | Promise<void>;
};

