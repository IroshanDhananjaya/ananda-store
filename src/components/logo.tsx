import Image from "next/image";
import logoFull from "./logo-full.png";
import logoMark from "./logo-mark.png";

// The Ananda Stores logo with a see-through background

/** Just the symbol (the "A" with the cart), for small spaces */
export function LogoMark({ size, className }: { size: number; className?: string }) {
  // Decorative: the store name is always written next to it
  return <Image src={logoMark} alt="" width={size} height={size} className={className} />;
}

/** The whole logo with its "Ananda STORE" lettering; `width` in px, the height follows */
export function LogoFull({ width, className }: { width: number; className?: string }) {
  return (
    <Image
      src={logoFull}
      alt="Ananda Stores"
      width={width}
      height={Math.round((width * logoFull.height) / logoFull.width)}
      loading="eager"
      className={className}
    />
  );
}
