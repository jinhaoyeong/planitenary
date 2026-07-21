import SwiftUI

struct SectionHeader: View {
    let eyebrow: String
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(eyebrow.uppercased())
                .font(.caption.weight(.semibold))
                .tracking(1.2)
                .foregroundStyle(ShellChrome.accent)

            AccentTitleText(title: title)
                .font(.title2.weight(.bold))
                .foregroundStyle(ShellChrome.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AccentTitleText: View {
    let title: String

    var body: some View {
        let parts = title.split(separator: " ", omittingEmptySubsequences: true)
        if parts.count <= 1 {
            Text(title)
        } else {
            let leading = parts.dropLast().joined(separator: " ")
            let accent = String(parts.last!)
            (Text(leading + " ") + Text(accent).font(.title2.weight(.bold).italic().design(.serif)))
                .foregroundStyle(ShellChrome.ink)
        }
    }
}

struct AppBrandTitle: View {
    var body: some View {
        (Text("Travel ") + Text("Handbook").font(.system(.largeTitle, design: .serif)).italic().bold())
            .foregroundStyle(ShellChrome.ink)
    }
}
