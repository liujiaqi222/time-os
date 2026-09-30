import { auth } from "@/auth/auth";

export const GET = (request: Request) => auth.handler(request);
export const HEAD = (request: Request) => auth.handler(request);
