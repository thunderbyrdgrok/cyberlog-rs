use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

const HELP: &str = "\
Usage: cyberlog [--port PORT] [--web DIR] [--ping]

Serve the Cyberlog journal on 127.0.0.1. The default port is 47660.
--ping exits 0 when /api/health is already answering on that port.
";

struct Args {
    port: u16,
    web: Option<PathBuf>,
    ping: bool,
}

fn main() -> ExitCode {
    let args = match parse_args(env::args().skip(1)) {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };
    if args.ping {
        return if cyberlog::ping(args.port) {
            ExitCode::SUCCESS
        } else {
            ExitCode::from(1)
        };
    }
    let web = match args.web.or_else(cyberlog::locate_web) {
        Some(web) => web,
        None => {
            eprintln!("Cyberlog could not find the web directory. Pass --web DIR.");
            return ExitCode::from(1);
        }
    };
    if let Err(error) = cyberlog::serve(args.port, &web) {
        eprintln!("Cyberlog did not start on 127.0.0.1:{}: {error}", args.port);
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

fn parse_args(args: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut port = 47660u16;
    let mut web = None;
    let mut ping = false;
    let mut args = args.peekable();
    while let Some(arg) = args.next() {
        if arg == "--help" || arg == "-h" {
            print!("{HELP}");
            std::process::exit(0);
        } else if arg == "--ping" {
            ping = true;
        } else if let Some(value) = arg.strip_prefix("--port=") {
            port = parse_port(value)?;
        } else if arg == "--port" {
            let value = args
                .next()
                .ok_or_else(|| format!("Cyberlog needs a port after --port.\n{HELP}"))?;
            port = parse_port(&value)?;
        } else if let Some(value) = arg.strip_prefix("--web=") {
            web = Some(PathBuf::from(value));
        } else if arg == "--web" {
            let value = args
                .next()
                .ok_or_else(|| format!("Cyberlog needs a directory after --web.\n{HELP}"))?;
            web = Some(PathBuf::from(value));
        } else {
            return Err(format!("Unknown argument: {arg}\n{HELP}"));
        }
    }
    Ok(Args { port, web, ping })
}

fn parse_port(value: &str) -> Result<u16, String> {
    let port: u16 = value
        .parse()
        .map_err(|_| format!("Not a port: {value}\n{HELP}"))?;
    if port == 0 {
        return Err(format!("Port must be between 1 and 65535.\n{HELP}"));
    }
    Ok(port)
}
