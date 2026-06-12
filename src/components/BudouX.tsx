"use client";

import * as React from "react";
import { memo, useMemo, type ReactNode } from "react";
import { loadDefaultJapaneseParser } from "budoux";

const parser = loadDefaultJapaneseParser();

type Props = {
    children: string;
    className?: string;
    as?: keyof React.JSX.IntrinsicElements;
};

export const BudouX = memo(function BudouX({ 
    children, 
    className,
    as: Component = "span" 
}: Props) {
    const segments = useMemo(() => {
        if (!children || typeof children !== "string") return [children];
        return parser.parse(children);
    }, [children]);

    return (
        <Component className={className} style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>
            {segments.map((segment, i) => (
                <span key={i} style={{ display: "inline-block" }}>
                    {segment}
                </span>
            ))}
        </Component>
    );
});

type TextProps = {
    children: ReactNode;
    className?: string;
};

export const BudouXText = memo(function BudouXText({ children, className }: TextProps) {
    if (typeof children !== "string") {
        return <span className={className}>{children}</span>;
    }
    return <BudouX className={className}>{children}</BudouX>;
});

export function useBudouX() {
    return {
        parse: (text: string) => parser.parse(text),
    };
}

export function budouxify(text: string): ReactNode {
    if (!text) return text;
    const segments = parser.parse(text);
    return segments.map((segment, i) => (
        <span key={i} style={{ display: "inline-block" }}>
            {segment}
        </span>
    ));
}
