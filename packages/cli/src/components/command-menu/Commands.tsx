import { Command } from "./types";

export const COMMANDS : Command[] = [
    {
        name: "new",
        description: "Start a new Conversation",
        value: "/new",
        action: (ctx) => {
            ctx.toast.show({
                variant: "success",
                message: "Starting a new conversation..."
            });
        },
    },
    {
        name: "login",
        description: "login to the agentic coder",
        value: "/login",
        action: (ctx) => {
            ctx.toast.show({
                variant: "info",
                message: "Opening login screen..."
            });
        },
    },
    {
        name: "logout",
        description: "logout from the agentic coder",
        value: "/logout",
        action: (ctx) => {
            ctx.toast.show({
                variant: "info",
                message: "Logging out..."
            });
        },
    },
    {
        name: "usage",
        description: "check the usage of models and status",
        value: "/usage",
        action: (ctx) => {
            ctx.toast.show({
                variant: "info",
                message: "Loading usage statistics..."
            });
        },
    },
    {
        name: "models",
        description: "select the models",
        value: "/models",
        action: (ctx) => {
            ctx.toast.show({
                variant: "success",
                message: "Opening model selection..."
            });
        },
    },
    {
        name: "agents",
        description: "select the agents",
        value: "/agents",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Select Mode",
                children: <text>Agent Selection coming soon...</text>
            });
        },
    },
    {
        name: "themes",
        description: "change the theme",
        value: "/themes",
        action: (ctx) => {
            ctx.toast.show({
                variant: "info",
                message: "Opening theme settings..."
            });
        },
    },
    {
        name: "sessions",
        description: "continue your previous sessions",
        value: "/sessions",
        action: (ctx) => {
            ctx.toast.show({
                variant: "success",
                message: "Loading previous sessions..."
            });
        },
    },
    {
        name: "upgrade",
        description: "buy more credits",
        value: "/upgrade",
        action: (ctx) => {
            ctx.toast.show({
                variant: "info",
                message: "Opening upgrade plans..."
            });
        },
    },
    {
        name : "exit",
        description : "Quit the Application",
        value : "/exit",
        action: (ctx) =>{
            ctx.exit();
        }
    },

]