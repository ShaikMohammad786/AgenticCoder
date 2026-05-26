import { Command } from "./types";

export const COMMANDS : Command[] = [
    {
        name : "new",
        description : "Start a new Conversation",
        value : "/new"
    },
    {
        name : "login",
        description : "login to the agentic coder",
        value : "/login"
    },
    {
        name : "logout",
        description : "logout from the agentic coder",
        value : "/logout"
    },
    {
        name : "usage",
        description : "check the usage of models and status",
        value : "/usage"
    },
    {
        name : "models",
        description : "select the models",
        value : "/models"
    },
    {
        name : "agents",
        description : "select the agents",
        value : "/agents"
    },
    {
        name : "themes",
        description : "change the theme",
        value : "/themes"
    },
    {
        name : "sessions",
        description : "continue your previous sessions",
        value : "/sessions"
    },
    {
        name : "upgrade",
        description : "buy more credits",
        value : "/upgrade"
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