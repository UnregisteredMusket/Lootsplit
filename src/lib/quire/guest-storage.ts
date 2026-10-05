// Campaign contents for players exist only in this document's memory.
// A sessionStorage reconnect ticket contains credentials, never campaign content.
let ephemeral = false;
export function isEphemeralCampaign() { return ephemeral; }
export function setEphemeralCampaign(value: boolean) { ephemeral = value; }
