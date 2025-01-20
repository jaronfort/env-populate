# env-populate

`env-populate` is a simple command line utility that traverses a directory to located `.env.example` files and creates `.env` files with the same content, but with placeholder values replaced with values from environment variables. `env-populate` has native support for Supabase environment variables using the `supabase status`. See the list of support placeholder names below.

## Installation
Use NPM to install `env-populate` globally.
```sh
npm install -g env-populate
```

## Usage
```sh
env-populate fill [options] [dir]
```

## Example
```sh
env-populate fill ./apps
```

## Build-in Placeholder Names
- `<supabase-url>`: The Supabase API URL.
- `<supabase-anon-key>`: The anonymous key of the Supabase project.
- `<supabase-service-role-key>`: The service key of the Supabase project.
- `<supabase-db-url>`: The URL of the Supabase database.
- `<supabase-graphql-url>`: The URL of the Supabase GraphQL API.

Any of these placeholder names can be overridden using the `--values` option (see description below).

## Custom Placeholder Names
Custom placeholder names can be used in `.env.example` files. These can be overridden using the `--values` option followed by a comma separated list (spaces not allowed).

```sh
env-populate populate --values placeholder1=value1,placeholder2=value2
```

It is possible to override build-in placeholder names using the `--values` option.

```sh
env-populate populate --values supabase-service-role-key=mySuperSecretKey
```

## Fill
The `fill` command is used to populate `.env` files in a directory. The command traverses the directory to locate `.env.example` files and creates `.env` files with the same content, but with placeholder values replaced with values from environment variables.

```sh
env-populate fill [options] [dir]
```

| Option          | Description                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--values`      | A comma separated list of placeholder values.                                                                                                             |
| `--vars`        | A comma separated list of environment variables to add.                                                                                                   |
| `-o` `--out`    | The filename of the `.env` file to generate in each directory. The default is `.env.local`                                                                |
| `--override`    | By default, env-populate will merge environment variables into the existing .env file. This option will force the entire file to be overridden.           |
| `--no-merge`    | Do not merge environment variables into the existing `.env` file. This option will skip `.env` files that already exist without merging in new variables. |
| `--verbose`     | Display additional information.                                                                                                                           |
| `--ignore`      | A comma separated list of patterns for directories to ignore.                                                                                             |
| `--silent`      | Do not display any output. This option will override --verbose option.                                                                                    |
| `--dry-run`     | Do not write `.env` files.                                                                                                                                |
| `-h` `--help`   | Display help for the command.                                                                                                                             |
| `v` `--version` | Display the version of the command.                                                                                                                       |
