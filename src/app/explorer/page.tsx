import { VariantPage } from "@/app/variant-page";
import type { PageSearchParams } from "@/app/variant-page";

export default function ExplorerPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  return <VariantPage searchParams={searchParams} variant="explorer" />;
}
