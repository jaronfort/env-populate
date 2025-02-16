# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [0.3.1] - 2025-01-20
### Fixed
- Fixed Supabase placeholders.

## [0.3.0] - 2025-01-20
### Added
- Added `<host-ip>` placeholder that populates the `.env` file with the host machine's IP address.

### Fixed
- Corrected the application name in the help output.

## [0.2.0] - 2025-01-20
### Added
- Add `--verbose`, `--silent`, and `--ignore` options to the `fill` (formally `populate`) command.

### Changed
- Renamed the `populate` command to `fill`.
- Renamed the `-output` option to `--out`.

### Fixed
- Fixed help not displaying properly.

## [0.1.0] - 2025-01-18
### Added
- Add basic functionality to scan directories for `.env.example` files and generate `.env` files from placeholder values within the `.env.example` file.

[0.3.1]: https://github.com/jaronfort/env-populate/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/jaronfort/env-populate/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jaronfort/env-populate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jaronfort/env-populate/releases/tag/v0.1.0
