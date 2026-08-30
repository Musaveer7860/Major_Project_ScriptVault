import re
import os
import json
import urllib.request
import urllib.error
from typing import List, Dict, Any, Tuple
from dotenv import load_dotenv
import httpx

load_dotenv()

LIB_DESCRIPTIONS = {
    "math": "Mathematical functions (sqrt, pow, sin, cos, etc.)",
    "os": "Operating system interfaces (file paths, env vars)",
    "sys": "System-specific parameters and command line arguments",
    "json": "JSON parsing, encoding, and decoding utility",
    "time": "Time access, formatting, and thread sleeping",
    "datetime": "Date and time manipulation and formatting",
    "random": "Pseudo-random number and choice generators",
    "re": "Regular expression pattern matching operations",
    "requests": "HTTP client library for making REST API requests",
    "urllib": "HTTP request handlers and URL parsing tools",
    "iostream": "C++ standard Input/Output stream objects (cin, cout)",
    "vector": "C++ dynamic array container implementation",
    "string": "C++ string operations and manipulations",
    "stdio.h": "C standard Input/Output library (printf, scanf, etc.)",
    "stdlib.h": "C standard library for utility functions (malloc, free, etc.)",
    "Scanner": "Java text scanner for reading keyboard and file input",
    "ArrayList": "Java resizable-array implementation of the List interface",
    "HashMap": "Java hash table based implementation of the Map interface",
    "List": "Java sequence collection structure interface",
    "Map": "Java key-value pair collection structure interface",
    "sqlite3": "SQLite database client integration library",
    "threading": "Multi-threaded execution and concurrency",
    "subprocess": "Spawning new processes and piping standard streams"
}

def compute_similarity(code1: str, code2: str) -> float:
    """Computes Jaccard similarity based on cleaned lines of code."""
    def get_clean_lines(code: str) -> set:
        lines = []
        for line in code.splitlines():
            line_strip = line.strip()

            if line_strip and not line_strip.startswith(('#', '//', '/*', '*')):
                lines.append(line_strip)
        return set(lines)

    lines1 = get_clean_lines(code1)
    lines2 = get_clean_lines(code2)
    
    if not lines1 and not lines2:
        return 1.0
    if not lines1 or not lines2:
        return 0.0
        
    intersection = lines1.intersection(lines2)
    union = lines1.union(lines2)
    return len(intersection) / len(union)

def analyze_duplicate(code: str, user_snippets: List[Dict[str, Any]], current_id: str = None) -> Dict[str, Any]:
    """Finds if a snippet has high duplicate similarity with existing snippets."""
    highest_sim = 0.0
    matching_snippet = None

    for s in user_snippets:
        if current_id and str(s.get("_id") or s.get("id")) == str(current_id):
            continue
        
        sim = compute_similarity(code, s.get("code", ""))
        if sim > highest_sim:
            highest_sim = sim
            matching_snippet = s

    if highest_sim > 0.8:
        return {
            "duplicate": True,
            "similarity": round(highest_sim * 100, 1),
            "matching_title": matching_snippet.get("title", "Untitled"),
            "matching_id": str(matching_snippet.get("_id") or matching_snippet.get("id"))
        }
    
    return {"duplicate": False, "similarity": 0.0}

def analyze_complexity(code: str, language: str) -> Tuple[str, str]:
    """Estimates time and space complexity based on loops and nesting depth."""
    lang = language.lower()
    lines = [l.strip() for l in code.splitlines() if l.strip()]
    
    loop_depth = 0
    max_loop_depth = 0
    has_recursion = False
    has_binary_search = False
    

    if "binarysearch" in code.lower() or "binary_search" in code.lower() or ("mid =" in code and ("/ 2" in code or ">> 1" in code)):
        has_binary_search = True
        

    func_names = re.findall(r'(?:def|function|void|int|double)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(', code)
    for fname in func_names:
        if fname not in ("main", "print", "printf", "cout", "cin"):

            call_pattern = rf'\b{fname}\b'
            matches = re.findall(call_pattern, code)
            if len(matches) > 1:
                has_recursion = True
                break

    for line in lines:
        is_loop = False
        if lang == "python":
            if line.startswith(("for ", "while ")):
                is_loop = True
        else:
            if re.search(r'\b(for|while)\b', line):
                is_loop = True
        
        if is_loop:
            loop_depth += 1
            if loop_depth > max_loop_depth:
                max_loop_depth = loop_depth
        elif "}" in line or (lang == "python" and line.startswith("def ")):

            loop_depth = max(0, loop_depth - 1)

    if has_recursion:
        time_comp = "O(2^N) - Exponential (Recursion detected)"
        space_comp = "O(N) - Linear recursion stack"
    elif has_binary_search:
        time_comp = "O(log N) - Logarithmic (Binary search patterns detected)"
        space_comp = "O(1) - Constant auxiliary space"
    elif max_loop_depth == 1:
        time_comp = "O(N) - Linear (Single loop detected)"
        space_comp = "O(1) - Constant space"
    elif max_loop_depth == 2:
        time_comp = "O(N^2) - Quadratic (Nested loops detected)"
        space_comp = "O(1) - Constant space"
    elif max_loop_depth > 2:
        time_comp = f"O(N^{max_loop_depth}) - Polynomial (Deep nested loops detected)"
        space_comp = "O(1) - Constant space"
    else:
        time_comp = "O(1) - Constant Time"
        space_comp = "O(1) - Constant Space"
        
    return time_comp, space_comp

def analyze_bugs(code: str, language: str) -> List[str]:
    """Finds syntactic bugs, style issues, or logical warnings in the code."""
    bugs = []
    lang = language.lower()
    

    brackets = {
        '(': ')',
        '{': '}',
        '[': ']'
    }
    stack = []
    for char in code:
        if char in brackets.keys():
            stack.append(char)
        elif char in brackets.values():
            if not stack:
                bugs.append("Mismatched closing bracket detected in source code.")
                break
            top = stack.pop()
            if brackets[top] != char:
                bugs.append(f"Mismatched bracket pair: '{top}' matched with '{char}'.")
                break
    if stack and len(bugs) == 0:
        bugs.append("Unclosed opening brackets detected at end of file.")

    if re.search(r'/\s*0(?:\.0*)?\b', code):
        bugs.append("Potential Division by Zero error detected.")

    if lang == "python":
        if re.search(r'^\s*print\s+["\'][^"\']*["\']\s*$', code, re.MULTILINE):
            bugs.append("Syntax Error: print statement missing parentheses (Python 3 standard).")
        if re.search(r'^\s*except\s*:', code, re.MULTILINE):
            bugs.append("Warning: Bare 'except:' clause catches all exceptions. Prefer catching specific exceptions.")
        if re.search(r'def\s+[a-zA-Z_]\w*\s*\(.*=\s*(?:\[\]|\{\})\s*\)', code):
            bugs.append("Warning: Mutable default argument detected (e.g. list or dict). Use 'None' instead.")
            
    elif lang in ("javascript", "html"):
        if re.search(r'if\s*\([^=]*=[^=]\)', code):
            bugs.append("Warning: Assignment operator '=' found inside 'if' conditional instead of comparisons ('==' or '===').")
        if lang == "javascript" and re.search(r'\bvar\s+[a-zA-Z_]', code):
            bugs.append("Style Warning: Using 'var' for variable declaration. Consider using 'let' or 'const' for block scoping.")
            
    elif lang == "html":
        open_divs = len(re.findall(r'<div\b', code))
        close_divs = len(re.findall(r'</div>', code))
        if open_divs != close_divs:
            bugs.append(f"HTML Warning: Div tag mismatch ({open_divs} opened, {close_divs} closed).")
            
    elif lang in ("c", "c++", "java"):
        for line in code.splitlines():
            line_s = line.strip()
            if line_s and not line_s.endswith((';', '{', '}', ',', '(', ')')) and not line_s.startswith(('#', '//', '/*', '*')):
                if not any(k in line_s for k in ("class ", "interface ", "public class ", "public static void main")):
                    bugs.append(f"Warning: Check line '{line_s[:30]}...' - might be missing a terminating semicolon ';'.")
                    break

    return bugs

def analyze_optimizations(code: str, language: str) -> List[str]:
    """Provides recommendations on optimization improvements."""
    opts = []
    lang = language.lower()

    if lang == "python":
        if "for " in code and ".append(" in code:
            opts.append("Optimize: Convert loop-appends into list comprehensions for faster execution.")
        if "open(" in code and "with open" not in code:
            opts.append("Best Practice: Use 'with open(...) as f' context manager to automatically close files safely.")
        if "in " in code and ("[" in code or "list" in code):
            opts.append("Performance: Convert lists to sets for O(1) membership lookup checks.")
            
    elif lang == "javascript":
        if "function(" in code:
            opts.append("Style: Consider modern ES6 arrow functions '() => {}' for cleaner lexical scoping.")
        if "==" in code and "===" not in code:
            opts.append("Security/Safety: Use strict equality '===' instead of weak comparison '==' to avoid type coercion issues.")
            
    elif lang in ("c", "c++"):
        if "std::vector" in code or "string" in code:
            if not "&" in code and "main" not in code:
                opts.append("Optimize: Pass heavy objects (vectors, strings) by const reference (e.g. 'const string& s') to prevent overhead copies.")
                
    elif lang == "sql":
        if "select *" in code.lower():
            opts.append("DB Optimization: Avoid SELECT *. Specify columns explicitly to reduce network payload and optimize query plans.")

    if not opts:
        opts.append("Code structure looks solid and follows standard practices.")
        
    return opts

def generate_explanation(code: str, language: str) -> str:
    """Generates a detailed, code-aware markdown explanation of the code snippet's logic."""
    lang = language.title()
    lines = code.splitlines()
    num_lines = len(lines)
    

    imports = []
    if language.lower() == "python":
        imports = re.findall(r'^(?:import|from)\s+([a-zA-Z0-9_]+)', code, re.MULTILINE)
    elif language.lower() in ("c", "c++"):
        imports = re.findall(r'#include\s*[<"]([a-zA-Z0-9_\.]+)[>"]', code)
    elif language.lower() == "java":
        imports = re.findall(r'import\s+([a-zA-Z0-9_\.]+);', code)
        imports = [imp.split('.')[-1] for imp in imports]
    
    imports = sorted(list(set(imports)))
    

    classes = re.findall(r'\bclass\s+([a-zA-Z0-9_]+)', code)
    classes = sorted(list(set(classes)))
    

    funcs = []
    if language.lower() == "python":
        funcs = re.findall(r'\bdef\s+([a-zA-Z0-9_]+)\s*\((.*?)\)', code)
    elif language.lower() in ("javascript", "html"):
        funcs = re.findall(r'\bfunction\s+([a-zA-Z0-9_]+)\s*\((.*?)\)', code)
        arrow_funcs = re.findall(r'\b(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*\((.*?)\)\s*=>', code)
        funcs.extend(arrow_funcs)
    else:
        raw_funcs = re.findall(r'\b([a-zA-Z0-9_<>]+)\s+([a-zA-Z0-9_]+)\s*\((.*?)\)', code)
        exclude_kw = {"if", "for", "while", "switch", "catch", "return", "else", "main"}
        for ret_type, name, params in raw_funcs:
            if ret_type not in ("new", "return") and name not in exclude_kw:
                funcs.append((name, params))

                
    funcs = sorted(list(set(funcs)), key=lambda x: x[0])
    

    variables = re.findall(r'\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([^;\n]+)', code)
    var_list = []
    seen_vars = set()
    for vname, val in variables:
        vname = vname.strip()
        if vname not in seen_vars and not vname in ("if", "elif", "else", "for", "while", "return"):
            val_clean = val.strip()
            if len(val_clean) < 30:
                var_list.append((vname, val_clean))
                seen_vars.add(vname)
                

    outputs = []
    raw_outputs = re.findall(r'(?:print|console\.log|println|printf)\s*\(\s*f?["\'](.*?)["\']', code)
    cout_outputs = re.findall(r'cout\s*<<\s*["\'](.*?)["\']', code)
    outputs.extend(raw_outputs)
    outputs.extend(cout_outputs)
    outputs = sorted(list(set(outputs)))

    explanation = f"### Code Logic Explanation\n\n"
    explanation += f"This is a **{lang}** code snippet consisting of **{num_lines} lines**.\n\n"
    
    if imports:
        explanation += "#### 📦 Dependencies & Imports\n"
        explanation += "The code loads the following external modules or headers:\n"
        for imp in imports:
            desc = LIB_DESCRIPTIONS.get(imp, "Loads package functionality into current scope.")
            explanation += f"- `{imp}`: {desc}\n"
        explanation += "\n"
        
    if classes:
        explanation += "#### 🏛️ Object Structures & Classes\n"
        explanation += "The snippet structures data using classes:\n"
        for cls in classes:
            explanation += f"- `{cls}`: Encapsulates state attributes and logic behaviors.\n"
        explanation += "\n"
        
    if funcs:
        explanation += "#### ⚙️ Functions & Definitions\n"
        explanation += "The code defines the following callable functions or methods:\n"
        for name, params in funcs:
            param_str = f"taking `{params}`" if params.strip() else "taking no parameters"
            explanation += f"- `{name}(...)`: Performs custom logic operations, {param_str}.\n"
        explanation += "\n"
        
    explanation += "#### 🚀 Control Flow & Execution\n"
    features = []
    if "if " in code or "else" in code or "elif" in code:
        features.append("Conditional branching checks (`if`/`else` control flow)")
    if "for " in code or "while " in code:
        features.append("Repetitive iteration cycles (`for` or `while` loops)")
    if "try" in code and ("except" in code or "catch" in code):
        features.append("Exception safety structures (`try`/`except` or `try`/`catch` safety nets)")
    if "return " in code:
        features.append("Value returns (`return` statement results)")
    if var_list:
        features.append("State variable storage & manipulation")
        
    if features:
        explanation += "Key runtime execution components utilized:\n"
        for feat in features:
            explanation += f"- **{feat}**\n"
        explanation += "\n"
        
    explanation += "#### 🔍 Step-by-Step Overview\n"
    step = 1
    
    if imports:
        explanation += f"{step}. Imports the required libraries ({', '.join([f'`{i}`' for i in imports])}) to enable standard operations.\n"
        step += 1
        
    if classes:
        explanation += f"{step}. Declares structure layout(s) via the class definitions ({', '.join([f'`{c}`' for c in classes])}).\n"
        step += 1
        
    if funcs:
        func_names = [f"`{f[0]}`" for f in funcs]
        explanation += f"{step}. Sets up sub-routines and operations inside methods/functions: {', '.join(func_names)}.\n"
        step += 1
        
    if var_list:
        vnames = [f"`{v[0]}` (initialized to `{v[1]}`)" for v in var_list[:3]]
        explanation += f"{step}. Allocates and initializes state variables: {', '.join(vnames)}.\n"
        step += 1
        
    if "for " in code or "while " in code:
        explanation += f"{step}. Loops through data sequences, executing repetitive execution cycles.\n"
        step += 1
        
    if "if " in code or "else" in code:
        explanation += f"{step}. Branches logic path based on conditional checks.\n"
        step += 1
        
    if outputs:
        sample_msg = f"\"{outputs[0]}\"" if len(outputs[0]) < 40 else "messages"
        explanation += f"{step}. Outputs logs/results to stdout (e.g. prints {sample_msg}).\n"
        step += 1
        
    if "return " in code:
        explanation += f"{step}. Returns computed final values back to the execution caller.\n"
        step += 1
        
    if step == 1:
        explanation += "1. The program executes linearly from top to bottom, evaluating expressions sequentially.\n"
        
    return explanation

def generate_tags(code: str, language: str) -> List[str]:
    """Generates tag suggestions based on code content."""
    tags = []
    code_l = code.lower()
    
    tags.append(language.lower())
    
    if "def " in code or "function" in code:
        tags.append("functions")
    if "class " in code:
        tags.append("oop")
    if "for " in code or "while " in code:
        tags.append("loops")
    if "recursion" in code_l or "recursive" in code_l:
        tags.append("recursion")
    if "try" in code and ("except" in code or "catch" in code):
        tags.append("safety")
        
    if "fetch" in code_l or "axios" in code_l or "requests" in code_l or "http" in code_l:
        tags.append("api")
        tags.append("networking")
    if "json" in code_l:
        tags.append("json")
    if "select" in code_l and "from" in code_l:
        tags.append("db")
        tags.append("sql")
    if "insert" in code_l or "update" in code_l or "delete" in code_l:
        tags.append("database")
    if "html" in code_l or "div" in code_l or "body" in code_l:
        tags.append("frontend")
    if "flex" in code_l or "grid" in code_l or "color:" in code_l:
        tags.append("css")
    if "assert" in code_l or "test" in code_l:
        tags.append("test")
    if "binary" in code_l or "tree" in code_l or "node" in code_l or "graph" in code_l:
        tags.append("data-structures")
    if "sort" in code_l:
        tags.append("algorithm")
        
    seen = set()
    unique_tags = []
    for t in tags:
        if t not in seen:
            seen.add(t)
            unique_tags.append(t)
            
    return unique_tags[:5]

def run_gemini_analysis(code: str, language: str) -> Dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not configured")
        
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    
    prompt = f"""You are an expert AI code analyzer. Analyze the following code snippet in {language}.
Return your analysis strictly as a JSON object with the following fields:
1. "explanation": A detailed, clear markdown explanation of the code snippet's logic, flow, and purpose. Use headers, bullet points, and code blocks if appropriate.
2. "bugs": A list of strings, each describing a potential syntax error, logical bug, or edge case warning found in the code. If none are found, return an empty list.
3. "optimizations": A list of strings, each describing an optimization recommendation (e.g. time/space performance, code style, best practices). If none are found, return a list containing a message that it looks solid.
4. "time_complexity": A short string representing the estimated time complexity (e.g. "O(N)", "O(1)", etc.) with a brief explanation.
5. "space_complexity": A short string representing the estimated space complexity with a brief explanation.
6. "suggested_tags": A list of up to 5 lowercase strings suggesting tags for this snippet.

Code:
```
{code}
```

Ensure the output is valid JSON and matches the schema above. Do not include markdown code block formatting (like ```json ... ```) in your raw response."""

    payload = {
        "contents": [{
            "parts": [{
                "text": prompt
            }]
        }],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    }
    
    headers = {
        "Content-Type": "application/json"
    }
    
    with httpx.Client(timeout=10.0) as client:
        response = client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()
        
    try:
        text_content = data["candidates"][0]["content"]["parts"][0]["text"]
        result = json.loads(text_content)
        return result
    except Exception as e:
        raise ValueError(f"Failed to parse Gemini response: {str(e)}")

def run_ai_analysis(code: str, language: str, user_snippets: List[Dict[str, Any]], current_id: str = None) -> Dict[str, Any]:
    """Aggregates code analysis outputs, using Gemini if configured, otherwise falling back offline."""
    dup = analyze_duplicate(code, user_snippets, current_id)
    
    api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        try:
            gemini_result = run_gemini_analysis(code, language)
            return {
                "explanation": gemini_result.get("explanation", ""),
                "bugs": gemini_result.get("bugs", []),
                "optimizations": gemini_result.get("optimizations", []),
                "time_complexity": gemini_result.get("time_complexity", "N/A"),
                "space_complexity": gemini_result.get("space_complexity", "N/A"),
                "suggested_tags": gemini_result.get("suggested_tags", []),
                "duplicate_detection": dup
            }
        except Exception as e:
            print(f"Gemini API analysis failed, falling back to offline analysis: {str(e)}")
            
    time_comp, space_comp = analyze_complexity(code, language)
    bugs = analyze_bugs(code, language)
    opts = analyze_optimizations(code, language)
    exp = generate_explanation(code, language)
    suggested_tags = generate_tags(code, language)
    
    return {
        "explanation": exp,
        "bugs": bugs,
        "optimizations": opts,
        "time_complexity": time_comp,
        "space_complexity": space_comp,
        "suggested_tags": suggested_tags,
        "duplicate_detection": dup
    }

