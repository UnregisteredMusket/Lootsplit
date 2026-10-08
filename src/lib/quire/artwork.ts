import { z } from "zod";

export const artworkSchema = z
  .string()
  .max(500000)
  .regex(/^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+|\/art\/[a-z0-9-]+\.webp)$/);
