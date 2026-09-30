import type { LoaderFunctionArgs } from "react-router";
import { forwardStatementDownload } from "../statement-download.server";

export function loader({ request }: LoaderFunctionArgs): Promise<Response> {
  return forwardStatementDownload(request);
}
