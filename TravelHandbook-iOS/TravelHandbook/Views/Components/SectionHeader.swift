import SwiftUI

struct SectionHeader: View {
    let eyebrow: String
    let title: String
    var subtitle: String? = nil
    var centered: Bool = false

    var body: some View {
        EditorialPageHeader(
            eyebrow: eyebrow,
            titleLeading: Self.split(title).leading,
            titleAccent: Self.split(title).accent,
            subtitle: subtitle,
            centered: centered
        )
    }

    private static func split(_ title: String) -> (leading: String, accent: String) {
        let parts = title.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        guard parts.count > 1 else { return ("", title) }
        return (parts.dropLast().joined(separator: " "), parts.last!)
    }
}

/// Web-style centered page title: eyebrow + serif headline with pink italic accent word.
struct EditorialPageHeader: View {
    let eyebrow: String
    let titleLeading: String
    let titleAccent: String
    var titleTrailing: String = ""
    var subtitle: String? = nil
    var centered: Bool = true
    var titleSize: CGFloat = 40

    var body: some View {
        VStack(alignment: centered ? .center : .leading, spacing: 14) {
            HStack(spacing: 8) {
                Circle()
                    .fill(ShellChrome.accent)
                    .frame(width: 6, height: 6)
                Text(eyebrow.uppercased())
                    .font(.caption.weight(.semibold))
                    .tracking(1.6)
                    .foregroundStyle(ShellChrome.inkMuted)
            }

            (
                Text(titleLeading.isEmpty ? "" : titleLeading + (titleLeading.hasSuffix(" ") ? "" : " "))
                    .foregroundStyle(ShellChrome.ink)
                + Text(titleAccent)
                    .italic()
                    .foregroundStyle(ShellChrome.accent)
                + Text(titleTrailing.isEmpty ? "" : (titleTrailing.hasPrefix(" ") || titleTrailing.hasPrefix(".") ? titleTrailing : " " + titleTrailing))
                    .foregroundStyle(ShellChrome.ink)
            )
            .font(.system(size: titleSize, weight: .regular, design: .serif))
            .multilineTextAlignment(centered ? .center : .leading)
            .fixedSize(horizontal: false, vertical: true)

            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
                    .multilineTextAlignment(centered ? .center : .leading)
                    .lineSpacing(3)
            }
        }
        .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
    }
}

struct AccentTitleText: View {
    let title: String

    var body: some View {
        let parts = title.split(separator: " ", omittingEmptySubsequences: true)
        if parts.count <= 1 {
            Text(title)
                .font(.system(.title2, design: .serif).weight(.bold))
                .foregroundStyle(ShellChrome.ink)
        } else {
            let leading = parts.dropLast().joined(separator: " ")
            let accent = String(parts.last!)
            (Text(leading + " ")
                .foregroundStyle(ShellChrome.ink)
             + Text(accent)
                .font(.system(.title2, design: .serif).weight(.bold).italic())
                .foregroundStyle(ShellChrome.accent))
        }
    }
}

struct AppBrandTitle: View {
    var size: CGFloat = 34

    var body: some View {
        (Text("Travel ")
            .foregroundStyle(ShellChrome.ink)
         + Text("Handbook")
            .italic()
            .foregroundStyle(ShellChrome.accent))
        .font(.system(size: size, weight: .regular, design: .serif))
    }
}
