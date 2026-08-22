"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: [
            "group toast",
            "relative flex w-full items-center gap-3 overflow-hidden rounded-xl border p-4 shadow-lg transition-all duration-300 ease-out",
            "backdrop-blur-lg bg-background/95 border-border/50",
            "[&>div]:flex [&>div]:items-center [&>div]:gap-3",
            // Entrance animations
            "animate-in slide-in-from-bottom-5 fade-in-0 zoom-in-95 duration-300",
            // Exit animations
            "group-[.swal2-hide]:animate-out group-[.swal2-hide]:slide-out-to-right-full group-[.swal2-hide]:fade-out-0 group-[.swal2-hide]:zoom-out-95",
          ],
          title: [
            "text-sm font-semibold text-foreground leading-tight",
          ],
          description: [
            "text-xs text-muted-foreground mt-1 leading-relaxed",
          ],
          actionButton: [
            "h-8 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
          ],
          cancelButton: [
            "h-8 px-3 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          ],
          success: [
            "!border-green-500/30 !bg-green-50/90 dark:!bg-green-950/30",
            "[&>div:first-child]:!text-green-600 dark:[&>div:first-child]:!text-green-400",
          ],
          error: [
            "!border-red-500/30 !bg-red-50/90 dark:!bg-red-950/30",
            "[&>div:first-child]:!text-red-600 dark:[&>div:first-child]:!text-red-400",
          ],
          warning: [
            "!border-yellow-500/30 !bg-yellow-50/90 dark:!bg-yellow-950/30",
            "[&>div:first-child]:!text-yellow-600 dark:[&>div:first-child]:!text-yellow-400",
          ],
          info: [
            "!border-blue-500/30 !bg-blue-50/90 dark:!bg-blue-950/30",
            "[&>div:first-child]:!text-blue-600 dark:[&>div:first-child]:!text-blue-400",
          ],
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      position="bottom-right"
      expand={false}
      richColors
      closeButton
      {...props}
    />
  )
}

export { Toaster }
