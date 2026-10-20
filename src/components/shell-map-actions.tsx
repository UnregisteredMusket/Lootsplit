import { createContext } from "react";
export const ShellMapActions = createContext<{
  campaignName: string;
  dm: boolean;
  seatKnown: boolean;
  unreadCount: number;
  openCampaign: () => void;
  changeRole: () => void;
  openManagement: () => void;
} | null>(null);
