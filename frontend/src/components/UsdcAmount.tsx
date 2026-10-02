export function UsdcAmount({ value }: { value: string }) {
  return <span className="hf-usdc-amount"><img src="/token-icons/usdc.svg" alt="USDC" /><span>{value}</span></span>;
}
