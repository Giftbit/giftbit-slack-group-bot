export interface Message {
    token: string;
    team_id: string;
    team_domain: string;
    channel_id: string;
    channel_name: string;
    timestamp: number;
    user_id: string;
    user_name: string;
    text: string;
    trigger_word: string;
}
